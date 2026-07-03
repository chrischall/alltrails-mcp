// Wire-level constants shared by client.ts and transport.ts.
//
// ────────────────────────────────────────────────────────────────────────────
// A note on how AllTrails authenticates
// ────────────────────────────────────────────────────────────────────────────
// AllTrails has NO official public API. Everything here targets the internal
// API that alltrails.com and the mobile apps use, reconstructed from observed
// browser traffic. Two things gate a successful request:
//
//   1. A static, anonymous *app key* the web/mobile client embeds and sends as
//      the `x-at-key` header. It is not a per-user secret — it identifies the
//      client. No value is stored in this repo: the client captures the live
//      one from the signed-in tab's own API traffic on first need and keeps it
//      in process memory only (client.ts).
//
//   2. DataDome bot protection, which fingerprints the HTTP client itself.
//      This is why every request runs as a same-origin fetch inside the user's
//      signed-in tab (transport.ts) — the browser carries the short-lived
//      `datadome` cookie and the login session with it.

export const BASE_URL = 'https://www.alltrails.com';

// Client-identifier header the web app sends alongside `x-at-key`. Observed as
// the constant value below; overridable via ALLTRAILS_CALLER.
export const DEFAULT_CALLER = 'Mugen';

// Locale header (`x-language-locale`) the web app sends. Overridable via
// ALLTRAILS_LOCALE.
export const DEFAULT_LOCALE = 'en-US';
