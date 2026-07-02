// Wire-level constants shared by client.ts (API calls) and auth.ts (session
// capture). Kept in a leaf module to avoid an import cycle between
// client.ts → auth.ts.
//
// ────────────────────────────────────────────────────────────────────────────
// A note on how AllTrails authenticates
// ────────────────────────────────────────────────────────────────────────────
// AllTrails has NO official public API. Everything here targets the internal
// API that alltrails.com and the mobile apps use, reconstructed from community
// projects and observed browser traffic. Two things gate a successful request:
//
//   1. A static, anonymous *app key* the web/mobile client embeds and sends as
//      the `x-at-key` header. It is not a per-user secret — it identifies the
//      client. The value below is the one observed in the wild; AllTrails may
//      rotate it, so it is overridable via ALLTRAILS_API_KEY and the fetchproxy
//      path re-captures it live from the browser.
//
//   2. A short-lived `datadome` anti-bot cookie (AllTrails fronts its API with
//      DataDome). Without a fresh one the API returns 403. The cookie is minted
//      by a real browser session, which is why the primary auth path lifts the
//      `Cookie` header straight out of a signed-in tab (see auth.ts).
//
// Per-user endpoints (profile, saved lists, completed trails) additionally need
// the logged-in session cookie — also carried in that same `Cookie` header.

export const BASE_URL = 'https://www.alltrails.com';

// The embedded anonymous app key, sent as `x-at-key`. Observed in multiple
// independent community clients. Overridable via ALLTRAILS_API_KEY because
// AllTrails rotates it; the fetchproxy auth path also captures the live value
// from the browser and prefers it over this fallback.
export const DEFAULT_ALLTRAILS_API_KEY = '3p0t5s6b5g4g0e8k3c1j3w7y5c3m4t8i';

// A browser-like User-Agent. AllTrails' bot protection rejects obvious
// non-browser agents, so we present a recent desktop Chrome UA by default.
// Overridable via ALLTRAILS_USER_AGENT.
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Client-identifier header the web app sends alongside `x-at-key`. Observed as
// the constant value below; overridable via ALLTRAILS_CALLER.
export const DEFAULT_CALLER = 'Mugen';

// Locale header (`x-language-locale`) the web app sends. Overridable via
// ALLTRAILS_LOCALE.
export const DEFAULT_LOCALE = 'en-US';

// The `Cookie` header we capture from the browser is only as fresh as the
// DataDome cookie inside it (~10 min TTL in practice). We don't get an explicit
// expiry, so the CookieSessionManager re-captures reactively on a 401/403
// rather than proactively on a timer — but we still surface this as the
// best-effort lifetime for diagnostics.
export const SESSION_TTL_MS = 10 * 60 * 1000;
