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
  protocol.ts       Wire-level constants (BASE_URL, embedded x-at-key app key, header/UA defaults)
  transport.ts      createAllTrailsTransport(): the fetchproxy bridge transport (createFetchproxyTransport, port 37149, domains alltrails.com, defaultSubdomain www, createServer test seam)
  client.ts         AllTrailsClient — bridge requests (transport.fetch inside the signed-in tab), live x-at-key capture (memory-only), 429 wait-and-replay, non-JSON interstitial guard
  config.ts         env-driven header/UA/api-key/user-id/timeout/ws-port/debug getters
  validate.ts       parseAllTrails(): zod validation of AllTrails responses at call sites (lenient reads / strict where a mistype must halt)
  gpx.ts            decodePolyline() (generalized Google polyline varint decoder) + trailToGpx() (offline-detail route geometry → GPX 1.1) + OfflineTrailSchema
  tools/
    _shared.ts      response helpers + resolveUserId (arg → ALLTRAILS_USER_ID → /api/alltrails/me users[0].id) + the compact projections (summarizeTrail/TrailDetail/Review/Photo/SearchResult/FeedItem + their loose schemas + fetchTrailListing)
    trails.ts       get_trail, get_trail_reviews, get_trail_photos, get_trail_weather, get_trail_gpx
    explore.ts      search, list_trails_by_state, list_trails_by_country
    user.ts         get_profile, list_user_lists, list_completed_trails, get_activity_feed (feed?: local|timeline|personal follows the actual feed; omitted → directory)
    healthcheck.ts  alltrails_healthcheck via registerBridgeHealthcheckTool (probes a real trail-detail path through the client)
tests/              mirrors src/; mocks AllTrailsClient.request via vi.spyOn; client tests inject a stub FetchproxyTransport; transport tests use the createServer seam
```

Tool files use `server.registerTool(name, schema, handler)` and export `registerXTools(server: McpServer, client: AllTrailsClient)`. `index.ts` passes those registrars to `runMcp({ tools: [...], deps: client })`, which calls each as `registerXTools(server, client)`.

## Environment

```
ALLTRAILS_WS_PORT             Optional. fetchproxy concentrator port (default 37149 — the WHOLE fleet + the Transporter extension share it; override only for local dev/test isolation)
ALLTRAILS_USER_ID             Optional. Numeric user id for the per-user tools; skips the /api/alltrails/me lookup (or targets another public profile)
ALLTRAILS_CALLER              Optional. Overrides the x-at-caller header (default "Mugen")
ALLTRAILS_LOCALE              Optional. Overrides the x-language-locale header (default "en-US")
ALLTRAILS_REQUEST_TIMEOUT_MS  Optional. Per-request timeout in ms (default 30000). Forwarded as the bridge's fetchTimeoutMs
ALLTRAILS_DEBUG_LOG           Optional. "1|true|yes|on" → log every request/response to stderr; also enables the bridge transport's per-request debug logging. Diagnostic only
```

`config.ts` reads env vars through `readEnvVar`/`readPortEnv`, which treat blank values, the strings `"undefined"`/`"null"`, and unsubstituted `${VAR}` placeholders as unset — defensive against MCP hosts passing the env block through unexpanded.

`.env` (project root) is loaded by `client.ts` via `loadDotenvSafely` (silently skipped if dotenv is unavailable, e.g. inside the mcpb bundle). Real env vars take precedence.

## Request routing (fetchproxy archetype — bridge required, no fallback)

AllTrails has **no username/password → token exchange**, and DataDome fingerprints the HTTP client itself (TLS/JA3): a cookie captured from the browser and replayed from Node gets `403`'d even while the identical same-origin fetch inside the signed-in tab returns 200 (verified live 2026-07-02). So this repo follows the fleet's **fetchproxy archetype** (redfin/zillow) with **no stored-cookie escape hatch**: **every API request runs as a same-origin fetch inside the user's signed-in alltrails.com tab** via `createFetchproxyTransport` (`src/transport.ts` — port 37149, `domains: ['alltrails.com']`, `defaultSubdomain: 'www'`).

`AllTrailsClient.request` → `transport.fetch({ method, path, headers, body })`. The browser owns `Cookie`/`User-Agent`/`Origin`; the client attaches only the protocol headers (`Accept`/`x-at-key`/`x-at-caller`/`x-language-locale`, plus `Content-Type` with a body) because an in-tab fetch does NOT add them (missing `x-at-key` → 400). Bridge-layer failures (extension down, pairing pending) are wrapped with `bridgeErrorInfo`'s remediation hint.

Response handling: `429` → wait 2s and replay once (bridge results carry no headers, so no `Retry-After`), then throw. `400`/`401` → the rotation signature: re-capture the app key (discarding values equal to the stale one) and replay once if a genuinely fresh key arrived; otherwise surface the original error. Non-2xx → throw (`401`/`403` get a signed-in-tab hint). A 2xx non-JSON body is a DataDome interstitial → actionable error, never a bare SyntaxError.

Onboarding: first bridge use shows a pair code in the Transporter extension popup (one-time, persists per identity). A signed-in alltrails.com tab must be open. `alltrails_healthcheck` diagnoses which hop broke.

Testing seams: client tests inject a stub `FetchproxyTransport` via the constructor; transport tests inject a mock `FetchproxyServer` via `createAllTrailsTransport`'s `createServer` argument — no `vi.mock('@fetchproxy/server')`.

## Response validation

Every JSON response is validated with zod at the call site via `parseAllTrails(schema, raw, ctx, mode)` (`src/validate.ts`). Schemas are `z.looseObject(...)` covering ONLY the fields the code reads — unknown keys pass through (and survive into the returned blob). `lenient` (default) warns to stderr and returns the raw response on mismatch; `strict` throws. Currently only `resolveUserId`'s `/api/alltrails/me` parse uses this; add a loose schema next to any new field-reading call site.

## AllTrails API notes (reverse-engineered — all unofficial)

- Base URL `https://www.alltrails.com`; internal paths under `/api/alltrails/...`.
- **`x-at-key`** is a static, anonymous *app key* (not a user secret) the web/mobile client embeds. **No value is stored in this repo or its config**: the client captures the live one from the tab's own API traffic (`captureRequestHeader`) on first need, holds it in process memory only, and re-captures reactively on the 400/401 rotation signature (discarding values equal to the stale key so it can't recapture its own requests). An in-tab fetch does NOT send it automatically — the client attaches it on every request (without it the API returns 400).
- **DataDome** fronts the API: the anti-bot `datadome` cookie (~10 min TTL) is required or it returns `403`, and DataDome also fingerprints the HTTP client — Node-originated requests can be 403'd even with a fresh cookie. This is why requests ride the user's own browser tab.
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

`vitest.config.ts` enforces 100% line/branch/function/statement coverage on `src/**` (excluding `src/index.ts`, the stdio entry point). Failing coverage fails CI. No real API calls — `AllTrailsClient.request` is mocked via `vi.spyOn`; client tests inject a stub `FetchproxyTransport`; transport tests inject a mock `FetchproxyServer` through the `createServer` seam.

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
- **Bridge required, no credential**: unlike the token-based siblings there is no resolved credential and no stored-cookie fallback — the signed-in tab IS the session, and DataDome 403s Node-originated requests regardless of cookie freshness.
- **Port 37149 is fleet-shared**: the Transporter extension dials that one concentrator port; never default this MCP to a different one.
- **Read-only**: no write tools exist. Keep it that way unless AllTrails write endpoints are actually needed and verified.
- **AI-maintained**: README warns this codebase is built and maintained by Claude; `src/index.ts` prints the same notice (plus the unofficial/ToS caveat) to stderr on startup.
