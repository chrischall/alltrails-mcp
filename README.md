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
- A signed-in AllTrails browser session (see [Authentication](#authentication))

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
      "args": ["/absolute/path/to/alltrails-mcp/dist/index.js"],
      "env": {
        "ALLTRAILS_COOKIE": "datadome=...; _at_session=..."
      }
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

AllTrails fronts its internal API with DataDome bot protection, so requests must carry the exact `Cookie` header a real signed-in browser sends — it includes a short-lived `datadome` anti-bot cookie plus (for per-user data) your login session. The server resolves that cookie via two paths, whichever succeeds first:

1. **`ALLTRAILS_COOKIE` env var (explicit).** Paste a Cookie header captured from your browser: open DevTools → Network on alltrails.com, click any `/api/alltrails/...` request, and copy the `Cookie` request header. Because the `datadome` cookie is short-lived, this needs periodic refresh.
2. **fetchproxy fallback (automatic).** With the [fetchproxy](https://github.com/chrischall/fetchproxy) browser extension installed and signed into alltrails.com, the server captures the `cookie` (and live `x-at-key`) request header once from your signed-in tab, then operates from Node directly — the extension is **not** in the request hot path. Set `ALLTRAILS_DISABLE_FETCHPROXY=1` to turn a missing cookie into a hard error (useful in headless CI).

If neither is available, the server throws with both fixes spelled out.

### Configuration

| Env var | Required | Purpose |
|---------|----------|---------|
| `ALLTRAILS_COOKIE` | No | Cookie header from a signed-in alltrails.com session (must include `datadome`). |
| `ALLTRAILS_USER_ID` | No | Numeric user id for the per-user tools; defaults to the signed-in user via `/api/alltrails/me`. |
| `ALLTRAILS_DISABLE_FETCHPROXY` | No | `1`/`true`/`yes`/`on` skips the fetchproxy fallback. |
| `ALLTRAILS_API_KEY` | No | Overrides the embedded `x-at-key` app key if AllTrails rotates it. |
| `ALLTRAILS_LOCALE` / `ALLTRAILS_CALLER` / `ALLTRAILS_USER_AGENT` | No | Override the corresponding request headers. |
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

The per-user tools default to the signed-in user (resolved via `/api/alltrails/me` or `ALLTRAILS_USER_ID`); pass `userId` to target a public profile.

## Troubleshooting

**403 Forbidden** — AllTrails' DataDome protection rejected the request, usually because the `datadome` cookie in your captured session went stale. Refresh a signed-in alltrails.com tab (or re-run the fetchproxy capture) and retry.

**"AllTrails auth: set ALLTRAILS_COOKIE…"** — neither auth path is configured. Either set `ALLTRAILS_COOKIE` in your config, or install the [fetchproxy extension](https://github.com/chrischall/fetchproxy) and sign into alltrails.com.

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
  protocol.ts       Wire-level constants (BASE_URL, app key, headers, TTL)
  client.ts         AllTrailsClient — cookie-session auth, 401/403 re-capture, 429 retry
  auth.ts           resolveAuth(): env cookie → fetchproxy capture → error
  config.ts         Env parsing (api key, headers, timeout, user id, debug)
  validate.ts       parseAllTrails(): zod validation of responses at call sites
  tools/
    _shared.ts      Response helpers + resolveUserId
    trails.ts       get_trail, reviews, photos, weather, gpx export
    explore.ts      search, list by state/country
    user.ts         profile, saved lists, completed trails, activity feed
tests/              Mirrors src/; mocks AllTrailsClient.request via vi.spyOn
```

### Auth flow

Auth resolution lives in `src/auth.ts`. Two paths, in priority order (then error):

1. **`ALLTRAILS_COOKIE` set** → used verbatim as the `Cookie:` header.
2. **fetchproxy** → `@fetchproxy/bootstrap` captures the `cookie` + `x-at-key` request headers once from your signed-in `www.alltrails.com/api/alltrails/*` traffic, then closes the bridge.

The resolved cookie session is managed by the fleet's `CookieSessionManager` (single-flight login, reactive re-capture on a `401`/`403`, one replay). All API calls then go out from Node directly — fetchproxy is **not** in the request hot path.

Also see the [fetchproxy README](https://github.com/chrischall/fetchproxy) for extension install instructions.

## License

MIT
