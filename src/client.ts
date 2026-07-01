import { loadDotenvSafely } from '@chrischall/mcp-utils';
import { createCookieSessionManager, type CookieSessionManager } from '@chrischall/mcp-utils/session';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { resolveAuth, AllTrailsConfigError, type AllTrailsSession } from './auth.js';
import { debugLogEnabled, getApiKey, getCaller, getLocale, getRequestTimeoutMs, getUserAgent } from './config.js';
import { BASE_URL } from './protocol.js';

// Load .env for local dev; silently skip if dotenv is unavailable (e.g. mcpb
// bundle). loadDotenvSafely applies override:false + quiet:true and swallows a
// missing dotenv module.
const __dirname = dirname(fileURLToPath(import.meta.url));
await loadDotenvSafely({ path: join(__dirname, '..', '.env') });

function redactCookie(h: Record<string, string>): Record<string, string> {
  const out = { ...h };
  if (out.Cookie) out.Cookie = `${out.Cookie.slice(0, 12)}… (${out.Cookie.length} chars)`;
  return out;
}

export class AllTrailsClient {
  // Cookie-session lifecycle is delegated to the shared, race-safe
  // CookieSessionManager: single-flight login (so a burst of concurrent callers
  // coalesces onto ONE `resolveAuth()`), reactive re-capture on an expiry-shaped
  // response, and clear-on-settle so a rejected login never sticks. A config
  // error (nothing configured) is cached as permanent so we don't re-run the
  // fetchproxy bridge on every tool call. Created lazily so the host's initial
  // tools/list always succeeds before any credential check runs.
  private sessionManager: CookieSessionManager<AllTrailsSession> | undefined;

  private getSessionManager(): CookieSessionManager<AllTrailsSession> {
    if (!this.sessionManager) {
      this.sessionManager = createCookieSessionManager<AllTrailsSession>({
        login: () => resolveAuth(),
        // DataDome expiry and a dropped login session both surface as 401/403.
        // Flag them so the manager re-captures the browser session and replays
        // the call exactly once.
        isExpired: (res) => res.status === 401 || res.status === 403,
        // A missing-config error is permanent for this process — re-running the
        // fetchproxy bridge won't help until the user changes their setup.
        isPermanentError: (err) => err instanceof AllTrailsConfigError,
      });
    }
    return this.sessionManager;
  }

  /** Issue an authenticated JSON request and parse the response body. */
  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchAuthed(method, path, body);
    const text = await response.text();
    if (debugLogEnabled()) {
      console.error(`[alltrails-debug] response body: ${text || '<empty>'}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  // Authenticated fetch. The 401/403 re-capture + one replay is delegated to
  // CookieSessionManager.withSession; the 429 wait-and-replay and the
  // non-2xx → throw remain here (mirroring the fleet's client shape).
  private async fetchAuthed(method: string, path: string, body: unknown): Promise<Response> {
    const mgr = this.getSessionManager();
    let attempt = 0;
    let response = await mgr.withSession((session) =>
      this.fetchOnce(method, path, body, session, attempt++ > 0),
    );
    if (response.status === 429) {
      // Honor a delta-seconds Retry-After when the server sends one (capped at
      // 30s so a hostile/buggy value can't stall the tool call); otherwise the
      // fleet's standard 2s.
      const retryAfterRaw = Number(response.headers.get('retry-after') ?? '');
      const waitMs =
        Number.isFinite(retryAfterRaw) && retryAfterRaw > 0
          ? Math.min(retryAfterRaw, 30) * 1000
          : 2000;
      await new Promise<void>((r) => setTimeout(r, waitMs));
      response = await mgr.withSession((session) => this.fetchOnce(method, path, body, session, true));
      if (response.status === 429) throw new Error('Rate limited by AllTrails API');
    }
    if (!response.ok) {
      const hint =
        response.status === 403
          ? ' — AllTrails uses DataDome bot protection; your captured session may be stale. Refresh a signed-in alltrails.com tab and retry.'
          : '';
      throw new Error(`AllTrails API error: ${response.status} ${response.statusText} for ${method} ${path}${hint}`);
    }
    return response;
  }

  // A single API fetch with the Cookie + protocol headers supplied by the
  // resolved session. Carries the per-request timeout (AbortController +
  // setTimeout so vitest fake timers can drive it) and the debug instrumentation.
  private async fetchOnce(
    method: string,
    path: string,
    body: unknown,
    session: AllTrailsSession,
    isRetry = false,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': getUserAgent(),
      'x-at-key': session.apiKey ?? getApiKey(),
      'x-at-caller': getCaller(),
      'x-language-locale': getLocale(),
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`,
      'Sec-Fetch-Site': 'same-origin',
      Cookie: session.cookieHeader,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

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

    return response;
  }
}

export const client = new AllTrailsClient();
