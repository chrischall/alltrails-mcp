// ────────────────────────────────────────────────────────────────────────────
// AllTrails client — fetchproxy bridge hot path + ALLTRAILS_COOKIE escape hatch
// ────────────────────────────────────────────────────────────────────────────
//
// THE TWO PATHS, in priority order:
//
//   1. Env cookie (escape hatch)
//      ALLTRAILS_COOKIE set → plain Node fetch with that Cookie header, for CI
//      or headless hosts without the Transporter extension. Best-effort:
//      DataDome fingerprints the HTTP client itself, so a valid cookie can
//      still be 403'd from Node (verified live 2026-07-02). There is nothing
//      to re-capture — a 401/403 surfaces directly with the hint.
//
//   2. Bridge (primary)
//      Every request runs as a same-origin fetch inside the user's signed-in
//      alltrails.com tab via the fetchproxy bridge (src/transport.ts). The
//      browser carries its own cookies; we attach only the AllTrails protocol
//      headers (x-at-key & co.), which an in-tab fetch does not add on its
//      own.
//
// THE x-at-key APP KEY is never stored in code or config: it is captured live
// from the tab's own API traffic (captureRequestHeader) on first need, held in
// process memory only, and reused for the life of the process. On a 400/401
// (the rotation signature) the client re-captures — discarding values equal to
// the stale key so it can't recapture its own in-flight requests — and replays
// once. ALLTRAILS_DISABLE_FETCHPROXY therefore disables the server entirely
// (even with a cookie, there is no way to obtain the key).

import { loadDotenvSafely, messageOf, readEnvVar } from '@chrischall/mcp-utils';
import { bridgeErrorInfo, type FetchproxyTransport } from '@chrischall/mcp-utils/fetchproxy';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createAllTrailsTransport } from './transport.js';
import {
  debugLogEnabled,
  getCaller,
  getLocale,
  getRequestTimeoutMs,
  getUserAgent,
  parseBoolEnv,
} from './config.js';
import { BASE_URL } from './protocol.js';

// Load .env for local dev; silently skip if dotenv is unavailable (e.g. mcpb
// bundle). loadDotenvSafely applies override:false + quiet:true and swallows a
// missing dotenv module.
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env') });

/**
 * A configuration error (bridge disabled with no cookie). Permanent for the
 * process — retrying a tool call won't help until the user changes their setup.
 */
export class AllTrailsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllTrailsConfigError';
  }
}

/** One upstream response, normalized across the bridge and Node paths. */
interface UpstreamResponse {
  status: number;
  statusText: string;
  bodyText: string;
  /** Delta-seconds Retry-After when the path exposes response headers (Node only). */
  retryAfterSeconds: number | null;
  /** Which path produced it — drives the 401/403 hint copy. */
  via: 'bridge' | 'cookie';
}

function redactCookie(h: Record<string, string>): Record<string, string> {
  const out = { ...h };
  out.Cookie = `${out.Cookie.slice(0, 12)}… (${out.Cookie.length} chars)`;
  return out;
}

/** The AllTrails protocol headers an in-tab fetch does NOT add on its own. */
function protocolHeaders(apiKey: string, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-at-key': apiKey,
    'x-at-caller': getCaller(),
    'x-language-locale': getLocale(),
  };
  if (hasBody) headers['Content-Type'] = 'application/json';
  return headers;
}

/** Where the app key is captured from: the tab's own API requests. */
const KEY_CAPTURE = { host: 'www.alltrails.com', path: '/api/alltrails/*', headerName: 'x-at-key' } as const;

export class AllTrailsClient {
  private transport: FetchproxyTransport | undefined;
  private startPromise: Promise<void> | undefined;
  private apiKey: string | undefined;
  private apiKeyPromise: Promise<string> | undefined;

  constructor(private readonly injected: { transport?: FetchproxyTransport } = {}) {}

  /**
   * The live-captured x-at-key, or undefined before the first capture. Memory
   * only — never persisted. Exposed so the photo projection can sign derived
   * image URLs with the same key the requests used.
   */
  currentApiKey(): string | undefined {
    return this.apiKey;
  }

  /**
   * Ensure a usable app key is in memory, capturing it from the tab's own API
   * traffic when absent (or when the cached key is `invalidKey` — the
   * rotation re-capture). Single-flight: concurrent callers share one capture.
   */
  private async ensureApiKey(invalidKey?: string): Promise<string> {
    if (this.apiKey !== undefined && this.apiKey !== invalidKey) return this.apiKey;
    if (!this.apiKeyPromise) {
      this.apiKeyPromise = this.captureApiKey(invalidKey).finally(() => {
        this.apiKeyPromise = undefined;
      });
    }
    return this.apiKeyPromise;
  }

  // One-shot header captures until a value differing from `invalidKey` shows
  // up. The stale-key filter matters: our own bridge requests hit the same
  // host/path pattern, so a rotation re-capture could otherwise snapshot one
  // of our own in-flight requests and hand back the key we're replacing.
  private async captureApiKey(invalidKey?: string): Promise<string> {
    const transport = await this.bridgeReady();
    console.error(
      '[alltrails-mcp] Capturing the x-at-key app key from the browser — open or refresh a signed-in ' +
        'www.alltrails.com page if this stalls.',
    );
    for (let attempt = 0; attempt < 3; attempt++) {
      let captured: string;
      try {
        captured = await transport.server.captureRequestHeader({ ...KEY_CAPTURE });
      } catch (e) {
        // The capture only fires when the tab itself makes an API request —
        // an idle tab times out. Say what to do, not just what failed.
        throw new Error(
          `AllTrails: capturing the x-at-key app key failed (${messageOf(e)}). The capture only sees ` +
            'requests the tab itself makes — open or refresh a signed-in www.alltrails.com page and retry.',
        );
      }
      if (captured !== invalidKey) {
        this.apiKey = captured;
        return captured;
      }
    }
    throw new Error(
      'AllTrails: could not capture a fresh x-at-key from the browser (kept seeing the stale value). ' +
        'Refresh a signed-in alltrails.com tab and retry.',
    );
  }

  /**
   * The bridge transport, created lazily (construction is cheap — the port
   * only binds on the first verb call). Public so the healthcheck tool can
   * probe/report bridge state without re-creating it.
   */
  bridge(): FetchproxyTransport {
    if (!this.transport) {
      this.transport = this.injected.transport ?? createAllTrailsTransport();
    }
    return this.transport;
  }

  /**
   * The bridge transport, started. `start()` loads the identity keypair and
   * must precede the first verb call; it runs single-flight (concurrent
   * callers share one start) and clears on rejection so a transient failure
   * (e.g. an unwritable identity dir) is retried on the next request instead
   * of sticking forever.
   */
  async bridgeReady(): Promise<FetchproxyTransport> {
    const transport = this.bridge();
    if (!this.startPromise) {
      this.startPromise = transport.start().catch((e: unknown) => {
        this.startPromise = undefined;
        throw e;
      });
    }
    await this.startPromise;
    return transport;
  }

  /** Issue an authenticated JSON request and parse the response body. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.performWithRetry(method, path, body);
    if (debugLogEnabled()) {
      console.error(`[alltrails-debug] response body: ${res.bodyText || '<empty>'}`);
    }
    if (!res.bodyText) return null as T;
    try {
      return JSON.parse(res.bodyText) as T;
    } catch {
      // A 2xx that isn't JSON is almost always a DataDome interstitial or an
      // HTML error page — surface that instead of a bare SyntaxError.
      throw new Error(
        `AllTrails returned non-JSON for ${method} ${path} — likely a DataDome bot challenge or an HTML ` +
          `error page. Refresh a signed-in alltrails.com tab and retry. Body starts: ${res.bodyText.slice(0, 120)}`,
      );
    }
  }

  // The 429 wait-and-replay-once, the rotation re-capture, and the
  // non-2xx → throw, shared by both paths.
  private async performWithRetry(method: string, path: string, body: unknown): Promise<UpstreamResponse> {
    let res = await this.perform(method, path, body, false);
    if (res.status === 429) {
      // Honor a delta-seconds Retry-After when the path exposes one (Node —
      // capped at 30s so a hostile/buggy value can't stall the tool call);
      // the bridge result carries no headers, so it waits the fleet's
      // standard 2s.
      const waitMs =
        res.retryAfterSeconds !== null && res.retryAfterSeconds > 0
          ? Math.min(res.retryAfterSeconds, 30) * 1000
          : 2000;
      await new Promise<void>((r) => setTimeout(r, waitMs));
      res = await this.perform(method, path, body, true);
      if (res.status === 429) throw new Error('Rate limited by AllTrails API');
    }
    if (res.status === 400 || res.status === 401) {
      // The rotation signature: AllTrails answers 400/401 when x-at-key is
      // missing or stale. Try to capture a DIFFERENT key from the tab; if the
      // app is still using ours, the capture keeps seeing the stale value and
      // throws — the failure was the request itself, so keep the original
      // error. Only a genuinely fresh key earns the one replay.
      const staleKey = this.apiKey;
      try {
        await this.ensureApiKey(staleKey);
      } catch {
        // No fresh key obtainable — fall through to the original response.
      }
      if (this.apiKey !== staleKey) {
        res = await this.perform(method, path, body, true);
      }
    }
    if (res.status < 200 || res.status >= 300) {
      const hint =
        res.status === 401 || res.status === 403
          ? res.via === 'bridge'
            ? ' — AllTrails uses DataDome bot protection; make sure you are signed into alltrails.com in an open browser tab (the bridge runs requests inside it) and retry.'
            : ' — AllTrails uses DataDome bot protection; the ALLTRAILS_COOKIE value is likely stale (the datadome cookie lives ~10 min). Capture a fresh one from a signed-in alltrails.com tab.'
          : '';
      throw new Error(`AllTrails API error: ${res.status} ${res.statusText} for ${method} ${path}${hint}`);
    }
    return res;
  }

  // Route one request: bridge disabled → config error (even with a cookie,
  // the x-at-key capture needs the bridge); env cookie → Node; else → bridge.
  private async perform(method: string, path: string, body: unknown, isRetry: boolean): Promise<UpstreamResponse> {
    if (parseBoolEnv('ALLTRAILS_DISABLE_FETCHPROXY')) {
      throw new AllTrailsConfigError(
        'AllTrails: the x-at-key app key is captured live from a signed-in alltrails.com tab via the ' +
          'fetchproxy Transporter extension, and ALLTRAILS_DISABLE_FETCHPROXY leaves no way to obtain it ' +
          '(no key is stored in code or config). Unset ALLTRAILS_DISABLE_FETCHPROXY and install the extension.',
      );
    }
    const envCookie = readEnvVar('ALLTRAILS_COOKIE');
    if (envCookie) return this.fetchNode(method, path, body, envCookie, isRetry);
    return this.fetchBridge(method, path, body, isRetry);
  }

  // Primary path: a same-origin fetch inside the signed-in tab. The browser
  // owns Cookie / User-Agent / Origin / Referer; we attach only the protocol
  // headers. Bridge-layer failures (extension down, pairing pending, timeout)
  // are wrapped with the typed error's remediation hint.
  private async fetchBridge(
    method: string,
    path: string,
    body: unknown,
    isRetry: boolean,
  ): Promise<UpstreamResponse> {
    const headers = protocolHeaders(await this.ensureApiKey(), body !== undefined);
    if (debugLogEnabled()) {
      const bodyPreview = body === undefined ? '<none>' : JSON.stringify(body);
      console.error(`[alltrails-debug] → ${method} ${path} via bridge${isRetry ? ' (retry)' : ''}`);
      console.error(`[alltrails-debug]   body: ${bodyPreview}`);
    }
    let result: { status: number; body: string };
    try {
      const transport = await this.bridgeReady();
      result = await transport.fetch({
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
        path,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      const info = bridgeErrorInfo(e);
      throw new Error(`AllTrails bridge: ${info.message}${info.hint ? ` ${info.hint}` : ''}`);
    }
    if (debugLogEnabled()) {
      console.error(`[alltrails-debug] ← ${result.status} (via bridge)`);
    }
    return {
      status: result.status,
      statusText: '',
      bodyText: result.body,
      retryAfterSeconds: null,
      via: 'bridge',
    };
  }

  // Escape hatch: direct Node fetch with the user-supplied Cookie header plus
  // the browser-shaped headers. Carries the per-request timeout
  // (AbortController + setTimeout so vitest fake timers can drive it) and the
  // debug instrumentation.
  private async fetchNode(
    method: string,
    path: string,
    body: unknown,
    cookieHeader: string,
    isRetry: boolean,
  ): Promise<UpstreamResponse> {
    const headers: Record<string, string> = {
      ...protocolHeaders(await this.ensureApiKey(), body !== undefined),
      'User-Agent': getUserAgent(),
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      'Sec-Fetch-Site': 'same-origin',
      Cookie: cookieHeader,
    };

    const url = `${BASE_URL}${path}`;
    if (debugLogEnabled()) {
      const bodyPreview = body === undefined ? '<none>' : JSON.stringify(body);
      console.error(`[alltrails-debug] → ${method} ${url}${isRetry ? ' (retry)' : ''}`);
      console.error(`[alltrails-debug]   headers: ${JSON.stringify(redactCookie(headers))}`);
      console.error(`[alltrails-debug]   body: ${bodyPreview}`);
    }

    // AbortController + setTimeout (not AbortSignal.timeout) so vitest fake
    // timers can drive the timeout in tests, and so we attach a clear error
    // message instead of a bare DOMException on the abort path.
    const timeoutMs = getRequestTimeoutMs();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        signal: ac.signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      if (ac.signal.aborted) {
        if (debugLogEnabled()) {
          console.error(`[alltrails-debug] ⏱ TIMEOUT after ${elapsed}ms: ${method} ${url}`);
        }
        throw new Error(`AllTrails API request timed out after ${timeoutMs}ms: ${method} ${path}`);
      }
      if (debugLogEnabled()) {
        console.error(`[alltrails-debug] ✗ ${(err as Error).message} after ${elapsed}ms: ${method} ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (debugLogEnabled()) {
      console.error(`[alltrails-debug] ← ${response.status} ${response.statusText} (${Date.now() - startedAt}ms)`);
    }

    const retryAfterRaw = Number(response.headers.get('retry-after') ?? '');
    return {
      status: response.status,
      statusText: response.statusText,
      bodyText: await response.text(),
      retryAfterSeconds: Number.isFinite(retryAfterRaw) && retryAfterRaw > 0 ? retryAfterRaw : null,
      via: 'cookie',
    };
  }
}

export const client = new AllTrailsClient();
