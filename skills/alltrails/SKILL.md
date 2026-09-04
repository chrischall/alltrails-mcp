---
name: alltrails
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
      "args": ["-y", "alltrails-mcp"]
    }
  }
}
```

Every API request routes through the **fetchproxy** browser bridge — it runs as a same-origin fetch inside your signed-in alltrails.com tab (DataDome fingerprints Node-originated requests, so there is no stored-cookie mode). Requirements: the fetchproxy Transporter extension installed, a signed-in alltrails.com tab open, and a one-time pair-code approval on first use. The `x-at-key` app key is never stored in code or config — it is captured live from the tab's own API traffic and held in memory only.

## Tools

### `view` — slim by default

Every tool marked `view?` below answers in one of two shapes, and the cheap one
is what you get for free:

- **`view: "compact"` (the default)** — a slim projection of just the fields
  you act on. Each tool's row says exactly which.
- **`view: "full"`** — AllTrails' whole untouched record.

You do not pass anything to get the compact answer. Reach for `view: "full"`
only when you need a field the projection drops — most often route geometry
from `alltrails_get_trail`.

**`view` is not `detail`.** `alltrails_get_trail` also takes a `detail`
(`basic`/`medium`/`offline`) argument, and that one is forwarded to AllTrails —
it decides what the API sends *us*. `view` decides what we hand back to you.
Full route geometry needs **both**: `detail: "offline"` to fetch it and
`view: "full"` to keep it.

### Discovery (still routed through the signed-in fetchproxy bridge)
| Tool | Notes |
|------|-------|
| `alltrails_search(query?, types?, lat?, lng?, limit?, view?)` | Search AllTrails by name. A free-text `query` uses the same suggestions endpoint as the alltrails.com search box (good relevance; may mix record types — pass `types: ["trail"]` for trails only). `lat`/`lng` are ignored by the API (results carry an implicit account/IP geo bias). Returns slim per-result summaries capped at `limit` by default; `view: "full"` returns AllTrails' whole records. This is the way to find trails in/near a place. |
| `alltrails_resolve_location(query, kinds?, limit?)` | Resolve a place name to AllTrails location records — `country`/`state`/`city`/`area`/`poi` — each with `{ name, kind, id, slug, latitude, longitude, region, country, label }`. Good for disambiguating (which "Oregon"?) or getting a place's coordinates/slug. |

### Trail detail
| Tool | Notes |
|------|-------|
| `alltrails_get_trail(trailId, detail?, view?)` | Trail details. `detail`: `basic` \| `medium` (default) \| `offline` (includes route geometry) — this one goes to AllTrails. Returns a slim projection by default (name, overview, length in m+mi, elevation gain in m+ft, difficulty, rating, route type, location); `view: "full"` returns the whole record, route geometry included. |
| `alltrails_get_trail_reviews(trailId, limit?, view?)` | User reviews (default limit 20). Returns just `{ user, rating, comment }` per review, under `{ count, reviews }`, by default; `view: "full"` returns AllTrails' whole review records. |
| `alltrails_get_trail_photos(trailId, view?)` | Trail photos. Returns `{ id, title, likeCount, user, uploadedAt, url }` per photo, under `{ count, photos }`, by default — `url` serves the actual image and is derived by the projection, so it is **not** in the `view: "full"` record. |
| `alltrails_get_trail_gpx(trailId)` | Export the trail's route as a GPX 1.1 document (track points with per-point elevation) — save to `.gpx` or import into nav apps. |
| `alltrails_get_trail_weather(trailId)` | Weather overview for the trail. |

### Per-user (requires a signed-in session)
| Tool | Notes |
|------|-------|
| `alltrails_get_profile` | The signed-in user's profile (`/api/alltrails/me`). |
| `alltrails_list_user_lists(userId?)` | Saved lists / favorites. Defaults to the signed-in user. |
| `alltrails_get_list_items(listId, view?)` | The trails saved in a list, by list id (from `list_user_lists`, or a public `list` record from `search`). Items are **sparse references** — each is `{ trailId, type, order, notes, addedAt }`; hydrate details with `get_trail`. By default the items are projected to those five fields and sorted by the curator's `order`; `view: "full"` returns the whole records, in the order AllTrails sent them. |
| `alltrails_list_completed_trails(userId?)` | Trails marked completed. Defaults to the signed-in user. |
| `alltrails_get_activity_feed(userId?, feed?, maxItems?, cursor?, view?)` | Activity feed. Without `feed` it returns the feed **directory** (just `{ name, displayName }` per feed by default); pass `feed`: `local` (nearby activity) \| `timeline` (people you follow) \| `personal` (own posts) for the actual items. Paginate with `cursor` (from `nextCursor`). Items are projected to `{ type, timestamp, user, trail, activity stats, review }` by default; `view: "full"` returns AllTrails' whole records. |

`userId` defaults to the signed-in user (resolved via `/api/alltrails/me`, or `ALLTRAILS_USER_ID`).

### Diagnostics
| Tool | Notes |
|------|-------|
| `alltrails_healthcheck` | Round-trips a probe through the fetchproxy bridge and reports role/port/timing plus a hint distinguishing "bridge never came up" from "extension not connected" from "AllTrails-side problem". Call it when a real tool fails. |

## Workflows

**Find a trail and read reviews:**
1. `alltrails_search(query: "angels landing", types: ["trail"])` → pick a trail id
2. `alltrails_get_trail(trailId)` → details
3. `alltrails_get_trail_reviews(trailId)` → what hikers say

**Review your own hiking history:**
1. `alltrails_get_profile` → confirm you're signed in
2. `alltrails_list_completed_trails()` / `alltrails_list_user_lists()`

## Caution

- All tools are **read-only** — this server never writes to AllTrails.
- Compact summaries include both metric and imperial fields (`lengthMeters`/`lengthMiles`, `elevationGainMeters`/`elevationGainFeet`) — no unit conversion needed.
- A `403` usually means the tab isn't signed in — sign into alltrails.com in an open tab and retry. An "AllTrails bridge:" error means the bridge itself failed — run `alltrails_healthcheck`. A key-capture stall means the tab is idle — open or refresh a www.alltrails.com page.
- Trail/user ids are numeric strings as they appear in AllTrails URLs.
