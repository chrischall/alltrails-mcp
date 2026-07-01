// ────────────────────────────────────────────────────────────────────────────
// Auth resolution — Pattern A (browser-bootstrap + Node-direct), cookie variant
// ────────────────────────────────────────────────────────────────────────────
//
// This mirrors the fleet's canonical "capture a signed-in browser session once,
// then operate from Node directly" shape (see ofw-mcp's auth.ts). AllTrails
// differs from the token-based siblings in one important way: there is NO
// documented username/password → token exchange. AllTrails fronts its internal
// API with DataDome bot protection, so the only reliable way in is to reuse the
// exact `Cookie` header a real signed-in browser sends — which already carries
// the fresh `datadome` anti-bot cookie AND (for per-user endpoints) the login
// session cookie. So the resolved "credential" here is a Cookie header string,
// not a Bearer token, and the whole lifecycle is managed by
// CookieSessionManager (client.ts) rather than TokenManager.
//
// THE THREE PATHS, in priority order:
//
//   1. Env cookie (escape hatch)
//      ALLTRAILS_COOKIE set → use it verbatim as the `Cookie:` header. For
//      power users who paste a header captured from DevTools, or CI. The
//      DataDome cookie inside it is short-lived, so this is best-effort.
//
//   2. fetchproxy fallback (primary path)
//      Capture the `cookie` (and live `x-at-key`) request header from the first
//      `www.alltrails.com/api/alltrails/*` call the signed-in browser tab makes
//      while the one-shot bridge is open, then close it. All subsequent API
//      calls go out via plain Node `fetch()` — fetchproxy is NOT in the hot
//      path. Opt out with ALLTRAILS_DISABLE_FETCHPROXY=1.
//
//   3. Error
//      Nothing to authenticate with. Throw an actionable message.
//
// Testability: `@fetchproxy/bootstrap` is mocked at the module boundary in
// tests, so path-selection logic stays independent of the bridge implementation.

import { readEnvVar } from '@chrischall/mcp-utils';
import { bootstrap } from '@fetchproxy/bootstrap';
import { classifyBridgeError, FetchproxyBridgeDownError } from '@chrischall/mcp-utils/fetchproxy';
import { parseBoolEnv } from './config.js';
import pkg from '../package.json' with { type: 'json' };

/** Result of resolving auth, regardless of which path was taken. */
export interface AllTrailsSession {
  /** The `Cookie:` request header value for API calls (datadome + login session). */
  cookieHeader: string;
  /** Live `x-at-key` captured from the browser, when available. Overrides the configured/default key. */
  apiKey?: string;
  /** Which path produced the session. Diagnostics only — callers must not branch on it. */
  source: 'env' | 'fetchproxy';
}

/**
 * A configuration error (nothing to authenticate with, or fetchproxy disabled
 * with no cookie). Distinct from a transient bridge failure so the
 * CookieSessionManager can cache it as permanent and stop retrying every call.
 */
export class AllTrailsConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllTrailsConfigError';
  }
}

/** True if the user has explicitly disabled the fetchproxy fallback. */
function fetchproxyDisabled(): boolean {
  return parseBoolEnv('ALLTRAILS_DISABLE_FETCHPROXY');
}

/**
 * Resolve an AllTrails session using the three-path priority above. Throws
 * {@link AllTrailsConfigError} when nothing is configured (permanent), or a
 * plain Error when the fetchproxy bridge fails transiently (worth retrying
 * once the user opens/refreshes an AllTrails tab).
 */
export async function resolveAuth(): Promise<AllTrailsSession> {
  // ── Path 1: env cookie escape hatch.
  const envCookie = readEnvVar('ALLTRAILS_COOKIE');
  if (envCookie) {
    return { cookieHeader: envCookie, source: 'env' };
  }

  // ── Path 2: fetchproxy fallback (primary path).
  if (!fetchproxyDisabled()) {
    try {
      const session = await bootstrap({
        serverName: pkg.name,
        version: pkg.version,
        // 'alltrails.com' matches www.alltrails.com (the extension treats each
        // domain as "exact host or any subdomain of it").
        domains: ['alltrails.com'],
        declare: {
          cookies: [],
          localStorage: [],
          sessionStorage: [],
          // Snapshot the exact request headers the signed-in web app sends to
          // its own API. The `cookie` header carries the fresh datadome + login
          // session; `x-at-key` gives us the live app key in case it rotated.
          captureHeaders: [
            { host: 'www.alltrails.com', path: '/api/alltrails/*', headerName: 'cookie' },
            { host: 'www.alltrails.com', path: '/api/alltrails/*', headerName: 'x-at-key' },
          ],
        },
        onWaiting: (hint) => {
          console.error(
            `[alltrails-mcp] Waiting on the browser: ${hint}. Open or refresh a page on ` +
              'www.alltrails.com (while signed in, with the fetchproxy extension installed) ' +
              'so the extension can capture an authenticated API request.',
          );
        },
      });

      const cookieHeader = session.capturedHeaders['cookie'];
      const apiKey = session.capturedHeaders['x-at-key'];
      if (!cookieHeader) {
        throw new Error(
          'no authenticated request to www.alltrails.com/api/alltrails was captured. ' +
            'Sign into alltrails.com in your browser (with the fetchproxy extension installed), ' +
            'open a trail page so the app makes an API call, and retry.',
        );
      }
      return { cookieHeader, apiKey: apiKey || undefined, source: 'fetchproxy' };
    } catch (e) {
      // FetchproxyBridgeDownError only escapes bootstrap() after the lazy-revive
      // retry fails — surface .hint verbatim (actionable "click toolbar icon" copy).
      if (classifyBridgeError(e) === 'bridge_down') {
        const downErr = e as FetchproxyBridgeDownError;
        throw new Error(
          `AllTrails auth: fetchproxy bridge is down (extension service worker unreachable after retry). ${downErr.hint}`,
        );
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`AllTrails auth: ALLTRAILS_COOKIE not set, and fetchproxy fallback failed: ${msg}`);
    }
  }

  // ── Path 3: nothing configured. Permanent — surface both fixes side-by-side.
  throw new AllTrailsConfigError(
    'AllTrails auth: set ALLTRAILS_COOKIE to a Cookie header from a signed-in alltrails.com ' +
      'session, or install the fetchproxy extension and sign into alltrails.com ' +
      '(unset ALLTRAILS_DISABLE_FETCHPROXY if it is set).',
  );
}
