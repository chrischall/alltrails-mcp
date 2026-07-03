// ────────────────────────────────────────────────────────────────────────────
// AllTrails client — every request rides the fetchproxy bridge
// ────────────────────────────────────────────────────────────────────────────
//
// There is exactly one route: each API request runs as a same-origin fetch
// inside the user's signed-in alltrails.com tab via the fetchproxy bridge
// (src/transport.ts). DataDome fingerprints the HTTP client itself, so
// Node-originated requests are rejected regardless of cookie freshness —
// there is no stored-cookie escape hatch. The browser carries its own
// cookies; the client attaches only the AllTrails protocol headers
// (x-at-key & co.), which an in-tab fetch does not add on its own.
//
// THE x-at-key APP KEY is never stored in code or config: it is captured live
// from the tab's own API traffic (captureRequestHeader) on first need, held in
// process memory only, and reused for the life of the process. On a 400/401
// (the rotation signature) the client re-captures — discarding values equal to
// the stale key so it can't recapture its own in-flight requests — and replays
// once.

import { loadDotenvSafely, messageOf } from '@chrischall/mcp-utils';
import { bridgeErrorInfo, type FetchproxyTransport } from '@chrischall/mcp-utils/fetchproxy';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createAllTrailsTransport } from './transport.js';
import { debugLogEnabled, getCaller, getLocale } from './config.js';

// Load .env for local dev; silently skip if dotenv is unavailable (e.g. mcpb
// bundle). loadDotenvSafely applies override:false + quiet:true and swallows a
// missing dotenv module.
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env') });

/** One bridge response — the `{status, body}` pair the client inspects. */
interface BridgeResult {
  status: number;
  body: string;
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

  /** Issue an authenticated JSON request and parse the response body. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchWithRetry(method, path, body);
    if (debugLogEnabled()) {
      console.error(`[alltrails-debug] response body: ${res.body || '<empty>'}`);
    }
    if (!res.body) return null as T;
    try {
      return JSON.parse(res.body) as T;
    } catch {
      // A 2xx that isn't JSON is almost always a DataDome interstitial or an
      // HTML error page — surface that instead of a bare SyntaxError.
      throw new Error(
        `AllTrails returned non-JSON for ${method} ${path} — likely a DataDome bot challenge or an HTML ` +
          `error page. Refresh a signed-in alltrails.com tab and retry. Body starts: ${res.body.slice(0, 120)}`,
      );
    }
  }

  // The 429 wait-and-replay-once, the rotation re-capture, and the
  // non-2xx → throw.
  private async fetchWithRetry(method: string, path: string, body: unknown): Promise<BridgeResult> {
    let res = await this.fetchBridge(method, path, body, false);
    if (res.status === 429) {
      // Bridge results carry no response headers (so no Retry-After) — wait
      // the fleet's standard 2s and replay once.
      await new Promise<void>((r) => setTimeout(r, 2000));
      res = await this.fetchBridge(method, path, body, true);
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
        res = await this.fetchBridge(method, path, body, true);
      }
    }
    if (res.status < 200 || res.status >= 300) {
      const hint =
        res.status === 401 || res.status === 403
          ? ' — AllTrails uses DataDome bot protection; make sure you are signed into alltrails.com in an open browser tab (the bridge runs requests inside it) and retry.'
          : '';
      throw new Error(`AllTrails API error: ${res.status} for ${method} ${path}${hint}`);
    }
    return res;
  }

  // One request through the bridge: a same-origin fetch inside the signed-in
  // tab. The browser owns Cookie / User-Agent / Origin / Referer; we attach
  // only the protocol headers. Bridge-layer failures (extension down, pairing
  // pending, timeout) are wrapped with the typed error's remediation hint.
  private async fetchBridge(method: string, path: string, body: unknown, isRetry: boolean): Promise<BridgeResult> {
    const headers = protocolHeaders(await this.ensureApiKey(), body !== undefined);
    if (debugLogEnabled()) {
      const bodyPreview = body === undefined ? '<none>' : JSON.stringify(body);
      console.error(`[alltrails-debug] → ${method} ${path} via bridge${isRetry ? ' (retry)' : ''}`);
      console.error(`[alltrails-debug]   body: ${bodyPreview}`);
    }
    let result: BridgeResult;
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
    return result;
  }
}

export const client = new AllTrailsClient();
