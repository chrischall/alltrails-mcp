# Route AllTrails API requests through the fetchproxy bridge

**Date:** 2026-07-02
**Status:** Approved direction from user ("it should be using fetchproxy to use chrome as the proxy for requests"); detail decisions made autonomously, review via draft PR.

## Problem

The current architecture (fleet Pattern A, cookie variant) uses `@fetchproxy/bootstrap`
once to capture the browser's `Cookie` header, then replays it from Node `fetch` for
every API call. Live testing on 2026-07-02 showed DataDome 403s **every** Node replay
of a freshly captured cookie — GET and POST alike — while the identical same-origin
in-tab fetch returns 200 seconds later. DataDome is fingerprinting the client (TLS/JA3),
not validating the cookie, so no amount of re-capture fixes the Node path. The fleet
skill documents this exact AllTrails failure mode and prescribes running requests
through the bridge itself.

## Decision

Adopt the fleet's **fetchproxy archetype** (redfin/zillow): every AllTrails API request
runs as a same-origin fetch inside the user's signed-in Chrome tab, via
`createFetchproxyTransport` from `@chrischall/mcp-utils/fetchproxy`. The bot wall never
sees Node.

Rejected alternatives:

- **Node-first with bridge fallback on 403** — keeps all the capture/session machinery
  *plus* a second transport; two code paths to test for no benefit while DataDome
  blocks Node universally.
- **Bridge-only (drop `ALLTRAILS_COOKIE`)** — kills the CI/headless escape hatch for
  no simplification worth having.

## Architecture

### New: `src/transport.ts`

A thin factory over `createFetchproxyTransport`:

```ts
createFetchproxyTransport({
  port: ALLTRAILS_WS_PORT ?? 37_149,   // fleet-shared concentrator port — do NOT invent a new one
  serverName: 'alltrails-mcp',
  version: VERSION,
  domains: ['alltrails.com'],
  defaultSubdomain: 'www',
  logListening: true,
  debugEnvVar: 'ALLTRAILS_DEBUG_LOG',
  fetchTimeoutMs: ALLTRAILS_REQUEST_TIMEOUT_MS (only when overridden),
  createServer,                         // test seam — vitest injects a mock FetchproxyServer
})
```

Created lazily (first tool call), held as a singleton on the client. Capabilities
default to `['fetch']` — no bootstrap declarations remain.

### Rewritten: `src/client.ts`

`AllTrailsClient.request<T>(method, path, body?)` routes by priority:

1. **`ALLTRAILS_COOKIE` set** → existing Node-direct `fetch` with that cookie plus the
   protocol headers (escape hatch for CI/headless; best-effort — DataDome may 403 it,
   and the error says so). No `CookieSessionManager`: an env cookie is static, there is
   nothing to re-capture, so 401/403 surfaces directly with the DataDome hint.
2. **`ALLTRAILS_DISABLE_FETCHPROXY` truthy** (and no cookie) → `AllTrailsConfigError`
   naming both fixes.
3. **Otherwise (primary)** → `transport.fetch({ method, path, headers, body })`.

Bridge-path details:

- Headers sent explicitly on every request: `Accept: application/json`, `x-at-key`
  (env override or embedded default), `x-at-caller`, `x-language-locale`, and
  `Content-Type: application/json` when a body is present. The browser owns
  `Cookie`/`User-Agent`/`Origin`/`Referer` — we no longer set them. (Verified live:
  an in-tab fetch without `x-at-key` gets 400; with it, 200.)
- We use the raw `fetch` verb (`{status, body, url}`), not `requestJson`, so the
  existing "2xx but non-JSON = DataDome interstitial" detection and its error copy
  survive unchanged.
- `429` → wait and replay once. The bridge result exposes no response headers, so the
  bridge path waits a fixed 2s (the env-cookie Node path keeps honoring
  `Retry-After` capped at 30s).
- `401`/`403` through the bridge → error telling the user to sign into alltrails.com
  in the tab / refresh it. No re-capture concept remains.
- Bridge-layer failures (extension down, pairing pending, timeout) → surface
  `bridgeErrorInfo(err)` hint text verbatim.

### Deleted

- `src/auth.ts` (bootstrap capture, `resolveAuth`, `AllTrailsSession`) —
  `AllTrailsConfigError` moves to `client.ts`.
- `CookieSessionManager` usage and the `@chrischall/mcp-utils/session` import.
- Dependency `@fetchproxy/bootstrap` (replaced by direct dep `@fetchproxy/server`,
  which `@chrischall/mcp-utils/fetchproxy` peers on; already ≥ the 0.11 floor).

**Amendment (same day, user directive):** the app key is never stored in code or
config. `DEFAULT_ALLTRAILS_API_KEY` and `ALLTRAILS_API_KEY` are removed; the client
captures the live `x-at-key` from the tab's own API traffic (`captureRequestHeader`)
on first need, holds it in process memory only, and re-captures reactively on the
400/401 rotation signature — discarding captured values equal to the stale key so it
cannot recapture its own in-flight requests. Consequences: `ALLTRAILS_DISABLE_FETCHPROXY`
now disables the server entirely (even with `ALLTRAILS_COOKIE`, there is no key
source), and the transport declares the `capture_request_header` capability (one-time
pairing re-approval in the Transporter extension).

### New tool: `alltrails_healthcheck`

`registerBridgeHealthcheckTool({ server, prefix: 'alltrails', probePath:
'/api/alltrails/v3/trails/10236086?detail=basic', hostLabel: 'www.alltrails.com',
transport, probeFn })` where `probeFn` routes through `client.request` so the probe
exercises the same headers/guards real tools use. Registered from a new
`registerHealthcheckTools` registrar wired in `index.ts`.

### Environment variables

| Var | Change |
|---|---|
| `ALLTRAILS_WS_PORT` | **New.** Bridge concentrator port, default 37149. |
| `ALLTRAILS_COOKIE` | Kept — now the *Node-direct escape hatch* (was priority path 1; still is, but documented as best-effort vs DataDome). |
| `ALLTRAILS_DISABLE_FETCHPROXY` | Kept — disables the bridge; without a cookie this is a hard config error. |
| `ALLTRAILS_USER_AGENT` | Kept — only affects the env-cookie Node path (the browser owns UA in bridge mode). |
| `ALLTRAILS_API_KEY` | **Removed** (amendment above) — the key is captured live, never configured. |
| Others (`ALLTRAILS_CALLER`, `ALLTRAILS_LOCALE`, `ALLTRAILS_REQUEST_TIMEOUT_MS`, `ALLTRAILS_DEBUG_LOG`, `ALLTRAILS_USER_ID`) | Unchanged in meaning; timeout also forwards to the bridge's `fetchTimeoutMs`. |

### Onboarding (docs)

First bridge use returns a pairing prompt — the user approves the pair code once in
the Transporter extension popup. A signed-in alltrails.com tab must be open for
requests to run. `alltrails_healthcheck` is the diagnostic.

## Error handling summary

| Condition | Behavior |
|---|---|
| Bridge down / not paired | Typed fetchproxy error → `bridgeErrorInfo` hint |
| 401/403 via bridge | Error: sign into / refresh an alltrails.com tab |
| 429 | Wait (2s bridge / `Retry-After` Node) + one replay, then error |
| 2xx non-JSON | DataDome-interstitial error (existing copy) |
| No cookie + bridge disabled | `AllTrailsConfigError` (permanent) |

## Testing

- `tests/transport.test.ts` — inject a mock `FetchproxyServer` via the `createServer`
  seam; assert constructor opts (port default + override, domains, subdomain) and verb
  delegation. No `vi.mock('@fetchproxy/server')`.
- `tests/client.test.ts` — rewrite: inject a stub transport; cover all three routing
  paths, 429 replay, 403 hint, non-JSON guard, timeout forwarding, debug logging.
- `tests/auth.test.ts` — deleted with `auth.ts`.
- Tool tests — unchanged (they mock `client.request`).
- Healthcheck tool test — mock `runProbe`/`status`.
- Coverage stays at enforced 100% on `src/**` (excluding `index.ts`).
- Live verification before PR: run `alltrails_search` + `alltrails_get_trail` through
  the real bridge and confirm 200s where Node replays 403'd.

## Out of scope

- Any change to tool schemas/projections (tools call `client.request` as before).
- Session-registry multi-account tools (no account concept needed — the tab is the session).
- Removing the read-only posture.
