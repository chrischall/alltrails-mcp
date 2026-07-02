# alltrails-mcp

Unofficial MCP server for AllTrails. Read-only access to trail search, trail details, reviews, photos, weather, and a signed-in user's saved lists / completed trails / activity feed. stdio transport.

> AllTrails has **no public API**. This reverse-engineers the internal one (alltrails.com), which is fronted by DataDome bot protection and governed by AllTrails' ToS. It may break at any time and automated use may violate their terms. This project is one of a **fleet** of sibling MCP servers (ofw-mcp is the canonical template); it copies that fleet's auth/validation/packaging patterns.

## Commands

```bash
npm run build        # tsc → dist/, then esbuild bundle → dist/bundle.js
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
npm run dev          # node --env-file=.env dist/index.js (requires built dist)
```

`dist/` is gitignored — it is produced at build/release time and shipped in the npm package (`package.json` `files`).

## Architecture

```
src/
  index.ts          MCP server entry — runMcp() from @chrischall/mcp-utils (builds McpServer, applies registrars with client as deps, prints banner, wires shutdown + stdio transport)
  protocol.ts       Wire-level constants (BASE_URL, embedded x-at-key app key, header/UA defaults, session TTL). Leaf module to break the client→auth import cycle
  client.ts         AllTrailsClient (cookie-session auth via CookieSessionManager, 401/403 re-capture + one replay, 429 wait-and-replay, JSON). Delegates auth to ./auth.ts
  auth.ts           resolveAuth(): two-path priority (ALLTRAILS_COOKIE env → fetchproxy capture → error) returning a Cookie header. Cookie variant of the fleet's Pattern A
  config.ts         env-driven header/UA/api-key/user-id/timeout/debug getters
  validate.ts       parseAllTrails(): zod validation of AllTrails responses at call sites (lenient reads / strict where a mistype must halt)
  gpx.ts            decodePolyline() (generalized Google polyline varint decoder) + trailToGpx() (offline-detail route geometry → GPX 1.1) + OfflineTrailSchema
  tools/
    _shared.ts      response helpers + resolveUserId (arg → ALLTRAILS_USER_ID → /api/alltrails/me users[0].id) + the compact projections (summarizeTrail/TrailDetail/Review/Photo/SearchResult/FeedItem + their loose schemas + fetchTrailListing)
    trails.ts       get_trail, get_trail_reviews, get_trail_photos, get_trail_weather, get_trail_gpx
    explore.ts      search, list_trails_by_state, list_trails_by_country
    user.ts         get_profile, list_user_lists, list_completed_trails, get_activity_feed (feed?: local|timeline|personal follows the actual feed; omitted → directory)
tests/              mirrors src/; mocks AllTrailsClient.request via vi.spyOn; auth tests mock @fetchproxy/bootstrap at the module boundary
```

Tool files use `server.registerTool(name, schema, handler)` and export `registerXTools(server: McpServer, client: AllTrailsClient)`. `index.ts` passes those registrars to `runMcp({ tools: [...], deps: client })`, which calls each as `registerXTools(server, client)`.

## Environment

```
ALLTRAILS_COOKIE              Optional. Cookie header from a signed-in alltrails.com session (must include the short-lived datadome cookie). Escape hatch / CI alternative to fetchproxy
ALLTRAILS_DISABLE_FETCHPROXY  Optional. "1|true|yes|on" → skip the fetchproxy fallback (missing cookie becomes a hard error)
ALLTRAILS_USER_ID             Optional. Numeric user id for the per-user tools; skips the /api/alltrails/me lookup (or targets another public profile)
ALLTRAILS_API_KEY             Optional. Overrides the embedded x-at-key app key if AllTrails rotates it (a live value captured via fetchproxy still wins)
ALLTRAILS_CALLER              Optional. Overrides the x-at-caller header (default "Mugen")
ALLTRAILS_LOCALE              Optional. Overrides the x-language-locale header (default "en-US")
ALLTRAILS_USER_AGENT          Optional. Overrides the browser-like User-Agent
ALLTRAILS_REQUEST_TIMEOUT_MS  Optional. Per-request timeout in ms (default 30000)
ALLTRAILS_DEBUG_LOG           Optional. "1|true|yes|on" → log every request/response to stderr (Cookie redacted). Diagnostic only
```

`config.ts`/`auth.ts` read env vars through `readEnvVar`, which treats blank values, the strings `"undefined"`/`"null"`, and unsubstituted `${VAR}` placeholders as unset — defensive against MCP hosts passing the env block through unexpanded.

`.env` (project root) is loaded by `client.ts` via `loadDotenvSafely` (silently skipped if dotenv is unavailable, e.g. inside the mcpb bundle). Real env vars take precedence.

## Auth resolution (Pattern A, cookie variant)

`src/auth.ts` follows the fleet's canonical "browser-bootstrap + Node-direct" shape (see ofw-mcp's auth.ts), but AllTrails has **no documented username/password → token exchange**. It fronts its API with DataDome, so the only reliable credential is the exact `Cookie` header a real signed-in browser sends (carrying the fresh `datadome` cookie plus the login session). So the resolved "credential" is a Cookie header string, not a Bearer token, and the lifecycle is managed by `CookieSessionManager` (client.ts) rather than `TokenManager`.

Two paths in priority order, then error:

1. **`ALLTRAILS_COOKIE`** → used verbatim as the `Cookie:` header.
2. **fetchproxy fallback** → `@fetchproxy/bootstrap` captures the `cookie` (and live `x-at-key`) request header from the first `www.alltrails.com/api/alltrails/*` call the signed-in browser tab makes while the one-shot bridge is open, then closes it. All subsequent API calls go out via direct Node fetch — fetchproxy is NOT in the hot path. Opt out with `ALLTRAILS_DISABLE_FETCHPROXY=1`.
3. **Error** → `AllTrailsConfigError` (permanent; the `CookieSessionManager` caches it so we don't re-run the bridge on every tool call).

`@fetchproxy/bootstrap` is mocked at the module boundary in tests, so path-selection logic stays independent of the bridge implementation.

### Client / session lifecycle

`AllTrailsClient` delegates the cookie session to `createCookieSessionManager` (`@chrischall/mcp-utils/session`): single-flight login (concurrent callers coalesce onto ONE `resolveAuth()`), reactive re-capture when a response is `401`/`403` (DataDome expiry) with exactly one replay, and clear-on-settle so a rejected login never sticks. A `429` is handled in the client (wait 2s, replay once, else throw). A non-2xx throws; a `403` message includes a DataDome-refresh hint. Requests carry `x-at-key`/`x-at-caller`/`x-language-locale`/`User-Agent`/`Origin`/`Referer`/`Sec-Fetch-Site` plus the resolved `Cookie`.

## Response validation

Every JSON response is validated with zod at the call site via `parseAllTrails(schema, raw, ctx, mode)` (`src/validate.ts`). Schemas are `z.looseObject(...)` covering ONLY the fields the code reads — unknown keys pass through (and survive into the returned blob). `lenient` (default) warns to stderr and returns the raw response on mismatch; `strict` throws. Currently only `resolveUserId`'s `/api/alltrails/me` parse uses this; add a loose schema next to any new field-reading call site.

## AllTrails API notes (reverse-engineered — all unofficial)

- Base URL `https://www.alltrails.com`; internal paths under `/api/alltrails/...`.
- **`x-at-key`** is a static, anonymous *app key* (not a user secret) the web/mobile client embeds. The embedded default lives in `protocol.ts`; AllTrails rotates it, so `ALLTRAILS_API_KEY` overrides and the fetchproxy path captures the live value.
- **DataDome** anti-bot cookie (`datadome`, ~10 min TTL) is required or the API returns `403`. This is why auth reuses the browser's `Cookie` header.
- Verified endpoints anchored on: `GET /api/alltrails/v3/trails/{id}?detail=...`, `POST /api/alltrails/v2/trails/{id}/reviews/search`, `GET /api/alltrails/v2/trails/{id}/photos`, `GET /api/alltrails/weather-service/v2/trails/{id}/overview`, `GET /api/alltrails/locations/{states|countries}/{id}/trails`, `GET /api/alltrails/me`, `GET /api/alltrails/users/{id}/{lists|trails/completed}`, `GET /api/alltrails/community/blazes/v0/users/{id}/feeds`.
- Response shapes below were captured live 2026-07-02 (via an in-browser fetchproxy bridge probe — Node replays of a captured cookie were 403'd by DataDome that day, but same-origin in-tab fetches sail through):
  - **`GET /me`** wraps the signed-in user as `{ users: [{ id, ... }] }` (NOT `{ user: ... }` — `resolveUserId` reads `users[0].id`, keeping the other variants as drift tolerance).
  - **`GET /v2/trails/{id}/photos`** → `{ photos: [{ id, title, description, likeCount, photoHash, user, location, metadata.created }] }`. No image URL in the record; `GET /api/alltrails/photos/{id}/image?size=large&key=<x-at-key>` (the `size` param is required) 302s to the images CDN and is **not** DataDome-walled — the compact projection derives it.
  - **`POST /explore/v1/suggestions`** is the real search-by-name endpoint — it's what the alltrails.com explore search box sends (request body captured verbatim 2026-07-02): `{"query":"angels landing","limit":50,"recordTypesToReturn":["country","state","city","area","poi","trail","guide","filter","list","sponsored_list"]}`. Response is `{ searchResults: [...], summary: { count } }` with the same Algolia-formatted records as `/explore/v1/search` (numeric `ID`, prefixed `objectID`). `limit` is honored, relevance is good, and `recordTypesToReturn` filters the result types. Body `lat`/`lng` are silently ignored — ambiguous queries get an implicit account/IP geo bias instead. `alltrails_search` routes free-text queries here.
  - **`POST /explore/v1/search`** → `{ summary: { count }, queryId, searchResults: [...], collections, boundingBox }`. Results are Algolia-formatted like the listings but `objectID` is prefixed (`"trail-{id}"`) — prefer the numeric `ID`. Probed 2026-07-02: **every request param is ignored** — `q`/`query`, `lat`/`lng`, `latitude`/`longitude`, bounding-box fields, and URL query params all returned the same results, anchored to the signed-in account's default location. `limit` was honored in the later probes but had been ignored earlier the same day (500 results for `limit: 5`), so compact mode still truncates client-side. The explore web page never calls it (map markers come from vector tiles). `alltrails_search` only uses it as the no-query fallback.
  - **`GET /v3/trails/{id}?detail=offline`** carries the route as Google encoded polylines under `trails[0].defaultMap.routes[].lineSegments[].polyline`: `pointsData` is 2-dim (lat, lng)×1e5; `indexedElevationData` is 2-dim (pointIndex×100, elevationMeters×1e5) with exactly one pair per point; `elevationData` was null. `alltrails_get_trail_gpx` decodes these into GPX 1.1.
  - **`GET .../users/{id}/feeds`** returns a feed **directory** (`{ feeds: [{ name, displayName, links }], initialFeedHint }`), not items. The items live at `.../feeds/{local|timeline|personal}?maxItems=N&cursor=...` → `{ sections: [{ section_type: 'feed-item', itemData: { itemType, timestamp, description (HTML), user, trail, activity { summaryStats }, review } }], pageInfo: { hasNextPage, nextCursor } }`. Units: `summaryStats.distanceTotal`/`elevationGain` are meters, `duration` is minutes, `timeTotal`/`timeMoving` are seconds.

## Testing

```bash
npm test           # vitest run
```

`vitest.config.ts` enforces 100% line/branch/function/statement coverage on `src/**` (excluding `src/index.ts`, the stdio entry point). Failing coverage fails CI. No real API calls — `AllTrailsClient.request` is mocked via `vi.spyOn`; auth tests mock `@fetchproxy/bootstrap`.

## Publishing constraints

The MCP Registry's [server.schema.json](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json) caps `server.json`'s `description` at **100 characters**. Values over that fail `mcp-publisher publish` with HTTP 422. Sanity-check before committing a description change:

```bash
jq -r '.description | length' server.json
```

## Versioning

Driven by **release-please**. Authoritative state lives in `.release-please-manifest.json`; release-please bumps every file registered in `release-please-config.json`'s `extra-files`:

- `package.json` / `package-lock.json` — handled by `release-type: node`
- `src/index.ts` — the `version: '…'` literal on the line marked `// x-release-please-version`
- `manifest.json` — `$.version`
- `server.json` — `$.version` and `$.packages[*].version`
- `.claude-plugin/plugin.json` — `$.version`
- `.claude-plugin/marketplace.json` — `$.plugins[*].version` and `$.metadata.version`

`tests/version-sync.test.ts` asserts every `// x-release-please-version` literal matches `package.json` — if you add a new version-bearing constant, add the marker comment and register the file in `release-please-config.json`.

### Important

Do NOT manually bump versions or create tags. Conventional-commit PR titles tell release-please what to do: `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE` → major. `chore:`, `docs:`, `ci:`, `test:`, `build:`, `refactor:` don't trigger a release on their own.

## Pull requests

**Default workflow: branch + PR. Direct pushes to `main` are blocked by branch protection.** PR titles use conventional-commit prefixes — release-please reads them to pick the next version and write the CHANGELOG entry. Open with `gh pr create`; the auto-review verdict adds `ready-to-merge` on `pass`/`warn`. The repo is squash-only.

The CI/release workflows are thin stubs that call the shared `chrischall/workflows` reusable pipelines (`reusable-mcp-ci.yml`, `mcp-publish`), identical to the rest of the fleet.

## Plugin / Distribution

```
.claude-plugin/
  plugin.json       Claude Code plugin manifest (points at .mcp.json and skills/)
  marketplace.json  Marketplace catalog entry
.mcp.json           Claude Code MCP server config (npx -y alltrails-mcp)
manifest.json       mcpb manifest (server.entry_point=dist/bundle.js, user_config)
server.json         MCP Registry manifest (npm package, env var schema)
skills/alltrails/SKILL.md   Claude Code skill describing when/how to use the tools
```

## Gotchas

- **ESM + NodeNext**: imports must use `.js` extensions even for `.ts` sources (e.g. `import { client } from './client.js'`).
- **stdio transport**: stdout is reserved for JSON-RPC. All logging goes to **stderr** (`console.error`).
- **Cookie auth, not Bearer**: unlike the token-based siblings, the resolved credential is a `Cookie` header; `CookieSessionManager` (not `TokenManager`) owns its lifecycle, and `401`/`403` (DataDome) both trigger re-capture.
- **Read-only**: no write tools exist. Keep it that way unless AllTrails write endpoints are actually needed and verified.
- **AI-maintained**: README warns this codebase is built and maintained by Claude; `src/index.ts` prints the same notice (plus the unofficial/ToS caveat) to stderr on startup.
