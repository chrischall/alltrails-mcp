---
name: alltrails-mcp
description: This skill should be used when the user asks about AllTrails hiking/trail data. Triggers on phrases like "find trails near", "AllTrails", "trail details", "hike reviews", "trail conditions", "my saved trails", "trails I've completed", or any request involving hiking trails, trail search, reviews, photos, or a user's AllTrails lists and activity.
---

# alltrails-mcp

**Unofficial** MCP server for AllTrails — read-only access to trail search, details, reviews, photos, weather, and a signed-in user's saved lists / completed trails / activity feed.

> ⚠️ AllTrails has **no public API**. This server reverse-engineers the internal one used by alltrails.com, which is fronted by DataDome bot protection and governed by AllTrails' Terms of Service. It may break at any time, and automated use may violate their ToS. Use at your own discretion for your own account.

- **npm:** [npmjs.com/package/alltrails-mcp](https://www.npmjs.com/package/alltrails-mcp)
- **Source:** [github.com/chrischall/alltrails-mcp](https://github.com/chrischall/alltrails-mcp)

## Setup

Add to `.mcp.json` in your project or `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "alltrails": {
      "command": "npx",
      "args": ["-y", "alltrails-mcp"],
      "env": {
        "ALLTRAILS_COOKIE": "datadome=...; _at_session=..."
      }
    }
  }
}
```

`ALLTRAILS_COOKIE` is a Cookie header copied from a signed-in alltrails.com browser tab (DevTools → Network → any `/api/alltrails/...` request → Request Headers → Cookie). It must include the short-lived `datadome` cookie, so it needs periodic refresh. If you omit it and have the **fetchproxy** browser extension installed, the server captures the cookie automatically from your signed-in tab.

## Tools

### Discovery (no sign-in required beyond a valid session cookie)
| Tool | Notes |
|------|-------|
| `alltrails_search(query?, lat?, lng?, limit?, compact?)` | Search trails by text and/or lat/lng. The endpoint can return hundreds of results regardless of `limit`, so use `compact=true` (strongly recommended) — slim summaries truncated to `limit` client-side. |
| `alltrails_list_trails_by_state(stateId, page?, perPage?, compact?)` | Paginated listing of trails in a state/region. `compact=true` returns a slim summary per trail (id, name, length, difficulty, rating, …) — far less output for browsing/ranking. |
| `alltrails_list_trails_by_country(countryId, page?, perPage?, compact?)` | Paginated listing of trails in a country (e.g. `313` = US). Supports `compact`. |

### Trail detail
| Tool | Notes |
|------|-------|
| `alltrails_get_trail(trailId, detail?, compact?)` | Trail details. `detail`: `basic` \| `medium` (default) \| `offline` (includes route geometry). `compact=true` returns a slim projection (name, overview, length in m+mi, elevation gain in m+ft, difficulty, rating, route type, location) — prefer it unless you need the full record or geometry. |
| `alltrails_get_trail_reviews(trailId, limit?, compact?)` | User reviews (default limit 20). `compact=true` returns just `{ user, rating, comment }` per review. |
| `alltrails_get_trail_photos(trailId, compact?)` | Trail photos. `compact=true` returns `{ id, title, likeCount, user, uploadedAt, url }` per photo — `url` serves the actual image. |
| `alltrails_get_trail_gpx(trailId)` | Export the trail's route as a GPX 1.1 document (track points with per-point elevation) — save to `.gpx` or import into nav apps. |
| `alltrails_get_trail_weather(trailId)` | Weather overview for the trail. |

### Per-user (requires a signed-in session)
| Tool | Notes |
|------|-------|
| `alltrails_get_profile` | The signed-in user's profile (`/api/alltrails/me`). |
| `alltrails_list_user_lists(userId?)` | Saved lists / favorites. Defaults to the signed-in user. |
| `alltrails_list_completed_trails(userId?)` | Trails marked completed. Defaults to the signed-in user. |
| `alltrails_get_activity_feed(userId?, feed?, maxItems?, cursor?, compact?)` | Activity feed. Without `feed` it returns the feed **directory**; pass `feed`: `local` (nearby activity) \| `timeline` (people you follow) \| `personal` (own posts) for the actual items. Paginate with `cursor` (from `nextCursor`). `compact=true` returns slim items (type, timestamp, user, trail, activity stats, review). |

`userId` defaults to the signed-in user (resolved via `/api/alltrails/me`, or `ALLTRAILS_USER_ID`).

## Workflows

**Find a trail and read reviews:**
1. `alltrails_search(query: "waterfall trails near Portland", compact: true)` → pick a trail id
2. `alltrails_get_trail(trailId)` → details
3. `alltrails_get_trail_reviews(trailId)` → what hikers say

**Review your own hiking history:**
1. `alltrails_get_profile` → confirm you're signed in
2. `alltrails_list_completed_trails()` / `alltrails_list_user_lists()`

## Caution

- All tools are **read-only** — this server never writes to AllTrails.
- Compact summaries include both metric and imperial fields (`lengthMeters`/`lengthMiles`, `elevationGainMeters`/`elevationGainFeet`) — no unit conversion needed.
- A `403` usually means the DataDome cookie in your session is stale — refresh a signed-in alltrails.com tab (or re-run the fetchproxy capture) and retry.
- Trail/user ids are numeric strings as they appear in AllTrails URLs.
