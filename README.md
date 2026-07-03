# AllTrails MCP

[![CI](https://github.com/chrischall/alltrails-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/chrischall/alltrails-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/alltrails-mcp)](https://www.npmjs.com/package/alltrails-mcp)
[![license](https://img.shields.io/npm/l/alltrails-mcp)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server that connects Claude to [AllTrails](https://www.alltrails.com), giving you natural-language access to trail search, trail details, reviews, photos, weather, and your own saved lists and hiking history.

> [!WARNING]
> **AI-developed project.** This codebase was entirely built and is actively maintained by [Claude](https://www.anthropic.com/claude). No human has audited the implementation. Review all code and tool permissions before use.

> [!CAUTION]
> **Unofficial and unsupported.** AllTrails has **no public API**. This server reverse-engineers the internal API used by alltrails.com. That API is fronted by [DataDome](https://datadome.co) bot protection and governed by AllTrails' Terms of Service. It may break without notice, and automated access may violate their ToS — a prior third-party AllTrails project was disabled at AllTrails' request. Use this only for your own account, at your own discretion.

## What you can do

Ask Claude things like:

- *"Find waterfall trails near Portland, Oregon"*
- *"What's the AllTrails rating and length of trail 10236086?"*
- *"Summarize the recent reviews for this trail"*
- *"What trails have I marked completed?"*
- *"Show me the trails on my saved 'weekend hikes' list"*

## Requirements

- [Claude Desktop](https://claude.ai/download) (or any MCP host)
- [Node.js](https://nodejs.org) 22.5 or later
- The [fetchproxy Transporter](https://github.com/chrischall/fetchproxy) browser extension and a signed-in alltrails.com tab (see [Authentication](#authentication))

## Acknowledgement of Terms

By using this MCP server, you acknowledge and agree to the following:

**1. This server accesses AllTrails using your own signed-in session.** It reuses the cookies from your own browser session; it cannot access anyone else's account or private data.

**2. [AllTrails' Terms of Service](https://www.alltrails.com/terms) govern your use of this server**, just as they govern your direct use of AllTrails. AllTrails restricts automated access and scraping, and fronts its API with bot protection. Automated use through this server may breach those terms. You are agreeing to AllTrails' terms every time you invoke a tool.

**3. Personal use only.** This project is not affiliated with, endorsed by, or sponsored by AllTrails, LLC. It is a personal automation tool. Do not use it to bulk-extract AllTrails' data, to build a competing product, or in any way that burdens their service.

**4. You accept full responsibility** for any consequences — technical (rate-limiting, CAPTCHA challenges, account action) or otherwise. The maintainer provides no warranty and no support.

This section is the maintainer's good-faith summary — it is not legal advice and does not modify or supersede AllTrails' actual ToS.

## Installation

### 1. Clone and build

```bash
git clone https://github.com/chrischall/alltrails-mcp.git
cd alltrails-mcp
npm install
npm run build
```

### 2. Add to Claude Desktop

Edit your Claude Desktop config file:

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the `alltrails` entry inside `"mcpServers"` (create the key if it doesn't exist):

```json
{
  "mcpServers": {
    "alltrails": {
      "command": "node",
      "args": ["/absolute/path/to/alltrails-mcp/dist/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/alltrails-mcp` with the path where you cloned the repo.

### 3. Restart Claude Desktop

Quit completely (Cmd+Q on Mac, not just close the window) and relaunch.

### 4. Verify

Ask Claude: *"Search AllTrails for trails near me."*

## Authentication

AllTrails fronts its internal API with DataDome bot protection, and DataDome fingerprints the HTTP client itself — a cookie copied out of the browser and replayed from Node can be rejected even while the browser sails through. So this server routes every API request through the [fetchproxy](https://github.com/chrischall/fetchproxy) bridge: each request runs as a same-origin fetch inside your own signed-in alltrails.com tab, reusing your authenticated session. Two paths, in priority order:

1. **`ALLTRAILS_COOKIE` env var (escape hatch).** Paste a Cookie header captured from your browser (DevTools → Network on alltrails.com → any `/api/alltrails/...` request → the `Cookie` request header). Requests go out from Node directly with that header — useful for CI or hosts without the extension, but best-effort: the `datadome` cookie is short-lived, and DataDome may reject Node-originated requests regardless.
2. **fetchproxy bridge (primary).** With the fetchproxy Transporter extension installed and a signed-in alltrails.com tab open, requests run inside that tab. On first use the extension shows a pair code — approve it once and the trust persists. Set `ALLTRAILS_DISABLE_FETCHPROXY=1` to opt out (a missing cookie then becomes a hard error).

If the bridge is disabled and no cookie is set, the server throws with both fixes spelled out. The `alltrails_healthcheck` tool round-trips a probe through the bridge and tells you which hop broke.

### Configuration

| Env var | Required | Purpose |
|---------|----------|---------|
| `ALLTRAILS_COOKIE` | No | Cookie header from a signed-in alltrails.com session (must include `datadome`) — switches to Node-direct requests, bypassing the bridge. |
| `ALLTRAILS_USER_ID` | No | Numeric user id for the per-user tools; defaults to the signed-in user via `/api/alltrails/me`. |
| `ALLTRAILS_DISABLE_FETCHPROXY` | No | `1`/`true`/`yes`/`on` disables the bridge (a missing cookie is then a hard error). |
| `ALLTRAILS_WS_PORT` | No | fetchproxy concentrator port (default `37149`, shared by the whole fetchproxy fleet — override only for local dev/tests). |
| `ALLTRAILS_API_KEY` | No | Overrides the embedded `x-at-key` app key if AllTrails rotates it. |
| `ALLTRAILS_LOCALE` / `ALLTRAILS_CALLER` / `ALLTRAILS_USER_AGENT` | No | Override the corresponding request headers (`ALLTRAILS_USER_AGENT` only affects the cookie escape hatch — the browser owns the UA in bridge mode). |
| `ALLTRAILS_REQUEST_TIMEOUT_MS` | No | Per-request timeout in ms (default `30000`), applied on both paths. |
| `ALLTRAILS_DEBUG_LOG` | No | `1`/`true`/`yes`/`on` logs every request/response to stderr (Cookie redacted). |

## Available tools

All tools are **read-only** — this server never writes to AllTrails.

| Tool | What it does |
|------|-------------|
| `alltrails_search` | Search AllTrails by trail or place name — free-text queries use the same suggestions endpoint as the alltrails.com search box (`compact` strongly recommended; `types: ["trail"]` narrows to trails only) |
| `alltrails_list_trails_by_state` | Paginated listing of trails in a state/region (`compact` for slim summaries) |
| `alltrails_list_trails_by_country` | Paginated listing of trails in a country, e.g. `313` = US (`compact` supported) |
| `alltrails_get_trail` | Trail details (`detail`: `basic`/`medium`/`offline`; `compact` for a slim projection) |
| `alltrails_get_trail_reviews` | User reviews for a trail (`compact` for `{user, rating, comment}`) |
| `alltrails_get_trail_photos` | Photos for a trail (`compact` for slim records with a fetchable image `url`) |
| `alltrails_get_trail_gpx` | Export a trail's route as GPX 1.1 (track points + elevation) |
| `alltrails_get_trail_weather` | Weather overview for a trail |
| `alltrails_get_profile` | The signed-in user's profile |
| `alltrails_list_user_lists` | A user's saved lists / favorites |
| `alltrails_list_completed_trails` | A user's completed trails |
| `alltrails_get_activity_feed` | A user's activity feed (`feed`: `local`/`timeline`/`personal` for the items, omit for the directory; `cursor` paginates; `compact` for slim items) |
| `alltrails_healthcheck` | Round-trips a probe through the fetchproxy bridge and reports role/port/timing plus a plain-English hint about which hop broke |

The per-user tools default to the signed-in user (resolved via `/api/alltrails/me` or `ALLTRAILS_USER_ID`); pass `userId` to target a public profile.

## Troubleshooting

**403 Forbidden** — AllTrails' DataDome protection rejected the request. In bridge mode this usually means the tab isn't signed in (or DataDome is challenging it) — sign into alltrails.com in an open tab and retry. With `ALLTRAILS_COOKIE`, the cookie is likely stale (the `datadome` cookie lives ~10 minutes) or DataDome is rejecting Node-originated traffic outright — prefer the bridge.

**"AllTrails bridge: …"** — the bridge itself failed before reaching AllTrails (extension not running, pairing not approved, no tab). Run `alltrails_healthcheck` for a diagnosis, and check the Transporter extension popup.

**"AllTrails auth: set ALLTRAILS_COOKIE…"** — the bridge is disabled (`ALLTRAILS_DISABLE_FETCHPROXY`) and no cookie is set. Either unset the disable flag and install the [fetchproxy extension](https://github.com/chrischall/fetchproxy), or set `ALLTRAILS_COOKIE`.

**Empty / unexpected results** — the internal AllTrails endpoints are undocumented and change over time; responses may shift. Enable `ALLTRAILS_DEBUG_LOG=1` to inspect the raw traffic on stderr.

## Development

```bash
npm test         # run the vitest suite
npm run build    # tsc → dist/, then esbuild bundle → dist/bundle.js
npm run dev      # node --env-file=.env dist/index.js (requires built dist)
```

`vitest.config.ts` enforces 100% coverage on `src/**` (except the stdio entry point). Main is protected — all changes land via PR. See `CLAUDE.md` for the full PR + release flow.

### Project structure

```
src/
  index.ts          MCP server entry (runMcp + StdioServerTransport)
  protocol.ts       Wire-level constants (BASE_URL, app key, headers)
  transport.ts      createAllTrailsTransport(): the fetchproxy bridge transport
  client.ts         AllTrailsClient — bridge hot path, ALLTRAILS_COOKIE escape hatch, 429 retry
  config.ts         Env parsing (api key, headers, timeout, port, user id, debug)
  validate.ts       parseAllTrails(): zod validation of responses at call sites
  tools/
    _shared.ts      Response helpers + resolveUserId
    trails.ts       get_trail, reviews, photos, weather, gpx export
    explore.ts      search, list by state/country
    user.ts         profile, saved lists, completed trails, activity feed
    healthcheck.ts  alltrails_healthcheck (bridge diagnostics)
tests/              Mirrors src/; mocks AllTrailsClient.request via vi.spyOn
```

### Request flow

Every API request runs as a same-origin fetch inside your signed-in alltrails.com tab, via the fetchproxy bridge (`src/transport.ts`, the shared `createFetchproxyTransport` factory). The browser carries its own cookies; the server attaches only the AllTrails protocol headers (`x-at-key` etc.), which an in-tab fetch doesn't add on its own. `ALLTRAILS_COOKIE` switches to a direct Node fetch instead — no bridge, best-effort against DataDome.

Also see the [fetchproxy README](https://github.com/chrischall/fetchproxy) for extension install instructions.

## License

MIT
