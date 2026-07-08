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

AllTrails fronts its internal API with DataDome bot protection, and DataDome fingerprints the HTTP client itself — a cookie copied out of the browser and replayed from Node gets rejected even while the browser sails through. So the [fetchproxy](https://github.com/chrischall/fetchproxy) bridge is **required**: every API request runs as a same-origin fetch inside your own signed-in alltrails.com tab, reusing your authenticated session. There is no stored-cookie mode.

Requirements: the fetchproxy Transporter extension installed, a signed-in alltrails.com tab open, and a one-time pair-code approval on first use (the trust persists).

The `x-at-key` app key AllTrails' own client sends is **never stored in this repo or your config** — the server captures the live value from your tab's own API traffic on first need, keeps it in memory only, and re-captures automatically if AllTrails rotates it. The `alltrails_healthcheck` tool round-trips a probe through the bridge and tells you which hop broke.

### Configuration

| Env var | Required | Purpose |
|---------|----------|---------|
| `ALLTRAILS_USER_ID` | No | Numeric user id for the per-user tools; defaults to the signed-in user via `/api/alltrails/me`. |
| `ALLTRAILS_WS_PORT` | No | fetchproxy concentrator port (default `37149`, shared by the whole fetchproxy fleet — override only for local dev/tests). |
| `ALLTRAILS_LOCALE` / `ALLTRAILS_CALLER` | No | Override the corresponding request headers. |
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
| `alltrails_get_list_items` | The trails saved in a list, by list id (`compact` for ordered `{trailId, order, notes}` — hydrate each via `get_trail`) |
| `alltrails_list_completed_trails` | A user's completed trails |
| `alltrails_get_activity_feed` | A user's activity feed (`feed`: `local`/`timeline`/`personal` for the items, omit for the directory; `cursor` paginates; `compact` for slim items) |
| `alltrails_healthcheck` | Round-trips a probe through the fetchproxy bridge and reports role/port/timing plus a plain-English hint about which hop broke |

The per-user tools default to the signed-in user (resolved via `/api/alltrails/me` or `ALLTRAILS_USER_ID`); pass `userId` to target a public profile.

## Troubleshooting

**403 Forbidden** — AllTrails' DataDome protection rejected the request. This usually means the tab isn't signed in (or DataDome is challenging it) — sign into alltrails.com in an open tab and retry.

**"AllTrails bridge: …"** — the bridge itself failed before reaching AllTrails (extension not running, pairing not approved, no tab). Run `alltrails_healthcheck` for a diagnosis, and check the Transporter extension popup.

**"AllTrails: capturing the x-at-key app key failed…"** — the key capture only sees requests your tab itself makes, and an idle tab makes none. Open or refresh a signed-in www.alltrails.com page and retry.

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
  client.ts         AllTrailsClient — bridge requests, live x-at-key capture, 429 retry
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

Every API request runs as a same-origin fetch inside your signed-in alltrails.com tab, via the fetchproxy bridge (`src/transport.ts`, the shared `createFetchproxyTransport` factory). The browser carries its own cookies; the server attaches only the AllTrails protocol headers (`x-at-key` etc.), which an in-tab fetch doesn't add on its own. There is no Node-direct mode — DataDome fingerprints the HTTP client, so only in-tab requests are reliable.

Also see the [fetchproxy README](https://github.com/chrischall/fetchproxy) for extension install instructions.

## License

MIT
