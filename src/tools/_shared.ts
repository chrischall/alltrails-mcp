import { decodeHtmlEntities, pruneUndefined, rawTextResult, textResult } from '@chrischall/mcp-utils';
import { z } from 'zod';
import type { AllTrailsClient } from '../client.js';
import { getConfiguredUserId } from '../config.js';
import { BASE_URL } from '../protocol.js';
import { parseAllTrails } from '../validate.js';

// Pretty-printed JSON tool result. Thin wrapper over @chrischall/mcp-utils'
// `textResult` so the rest of the codebase keeps the local name.
export const jsonResponse = textResult;

// Raw-string tool result. Wrapper over @chrischall/mcp-utils' `rawTextResult`.
export const textResponse = rawTextResult;

// `GET /api/alltrails/me` returns the signed-in user; we only read the id.
// The live endpoint wraps it as `{ users: [{ id, ... }] }` (captured
// 2026-07-02); the `user`/top-level variants are kept as drift tolerance.
// Loose: every other field passes through untouched.
const MeSchema = z.looseObject({
  users: z.array(z.looseObject({ id: z.union([z.number(), z.string()]).optional() })).optional(),
  user: z.looseObject({ id: z.union([z.number(), z.string()]).optional() }).optional(),
  id: z.union([z.number(), z.string()]).optional(),
});

/**
 * Resolve the AllTrails user id for the per-user endpoints. Priority:
 *   1. an explicit `userId` argument passed to the tool,
 *   2. the ALLTRAILS_USER_ID env var,
 *   3. a `GET /api/alltrails/me` lookup of the signed-in user.
 *
 * Throws an actionable error if none of those yields an id (e.g. the session
 * isn't actually signed in — `/me` is anonymous).
 */
export async function resolveUserId(client: AllTrailsClient, provided?: string): Promise<string> {
  const explicit = provided?.trim() || getConfiguredUserId();
  if (explicit) return explicit;
  const me = parseAllTrails(MeSchema, await client.request('GET', '/api/alltrails/me'), 'GET /api/alltrails/me');
  const id = me?.users?.[0]?.id ?? me?.user?.id ?? me?.id;
  if (id === undefined || id === null || `${id}`.length === 0) {
    throw new Error(
      'Could not determine your AllTrails user id from /api/alltrails/me — you may not be signed in. ' +
        'Pass a userId explicitly, set ALLTRAILS_USER_ID, or capture a signed-in browser session.',
    );
  }
  return `${id}`;
}

// A single trail as it appears in the `locations/{states|countries}/{id}/trails`
// listing responses. Loose — only the fields the compact projection reads are
// named; everything else passes through. The id lives under `objectID`/`ID`/`id`
// depending on the endpoint variant, so all three are optional.
const RawTrailSchema = z.looseObject({
  objectID: z.union([z.number(), z.string()]).optional(),
  ID: z.union([z.number(), z.string()]).optional(),
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  slug: z.string().optional(),
  length: z.number().optional(),
  elevation_gain: z.number().optional(),
  difficulty_rating: z.union([z.number(), z.string()]).optional(),
  avg_rating: z.number().optional(),
  num_reviews: z.union([z.number(), z.string()]).optional(),
  area_name: z.string().optional(),
  state_name: z.string().optional(),
  popularity: z.number().optional(),
});
type RawTrail = z.infer<typeof RawTrailSchema>;

// Listing envelope: the endpoints wrap the results in `{ trails: [...] }`.
export const TrailListSchema = z.looseObject({
  trails: z.array(RawTrailSchema).optional(),
});

/** A compact, agent-friendly projection of a listing trail — the fields worth ranking on. */
export interface TrailSummary {
  id?: string;
  name?: string;
  slug?: string;
  lengthMeters?: number;
  /** Derived from lengthMeters (2 decimal places) — AllTrails stores metric. */
  lengthMiles?: number;
  elevationGainMeters?: number;
  /** Derived from elevationGainMeters (whole feet). */
  elevationGainFeet?: number;
  difficulty?: number | string;
  rating?: number;
  numReviews?: number | string;
  area?: string;
  region?: string;
  popularity?: number;
}

const METERS_PER_MILE = 1609.344;
const FEET_PER_METER = 3.28084;

/** Meters → miles, rounded to 2 decimals. Undefined passes through. */
export function metersToMiles(m: number | undefined): number | undefined {
  return m === undefined ? undefined : Math.round((m / METERS_PER_MILE) * 100) / 100;
}

/** Meters → feet, rounded to a whole number. Undefined passes through. */
export function metersToFeet(m: number | undefined): number | undefined {
  return m === undefined ? undefined : Math.round(m * FEET_PER_METER);
}

/**
 * Project a raw listing trail into a {@link TrailSummary}. `undefined` fields
 * are dropped by `JSON.stringify`, so the emitted object only carries what the
 * API actually returned. The id falls back across the endpoint's id variants.
 * Imperial fields are derived locally (AllTrails stores metric), so an agent
 * answering a US user never has to do the conversion itself.
 */
export function summarizeTrail(raw: RawTrail): TrailSummary {
  const id = raw.objectID ?? raw.ID ?? raw.id;
  return {
    id: id === undefined ? undefined : `${id}`,
    name: raw.name,
    slug: raw.slug,
    lengthMeters: raw.length,
    lengthMiles: metersToMiles(raw.length),
    elevationGainMeters: raw.elevation_gain,
    elevationGainFeet: metersToFeet(raw.elevation_gain),
    difficulty: raw.difficulty_rating,
    rating: raw.avg_rating,
    numReviews: raw.num_reviews,
    area: raw.area_name,
    region: raw.state_name,
    popularity: raw.popularity,
  };
}

// Detail-only fields on `GET /v3/trails/{id}` (same `{ trails: [...] }`
// envelope as the listings, richer per-trail record). Loose as always.
const RawTrailDetailSchema = RawTrailSchema.extend({
  overview: z.string().optional(),
  routeType: z.looseObject({ name: z.string().optional() }).optional(),
  location: z
    .looseObject({
      latitude: z.number().optional(),
      longitude: z.number().optional(),
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
    })
    .optional(),
});

// Detail envelope — one-element `trails` array in practice; we project them all.
export const TrailDetailSchema = z.looseObject({
  trails: z.array(RawTrailDetailSchema).optional(),
});

/** {@link TrailSummary} plus the detail-only fields worth keeping in compact mode. */
export interface TrailDetailSummary extends TrailSummary {
  overview?: string;
  routeType?: string;
  location?: { latitude?: number; longitude?: number; city?: string; region?: string; country?: string };
}

/** Project a raw detail trail: the listing summary plus overview/route type/location. */
export function summarizeTrailDetail(raw: z.infer<typeof RawTrailDetailSchema>): TrailDetailSummary {
  const location = raw.location && {
    latitude: raw.location.latitude,
    longitude: raw.location.longitude,
    city: raw.location.city,
    region: raw.location.region,
    country: raw.location.country,
  };
  return {
    ...summarizeTrail(raw),
    overview: raw.overview,
    routeType: raw.routeType?.name,
    // Drop location entirely when the object carried no usable fields — otherwise
    // it would serialize to a noisy empty `{}`.
    location: location && Object.values(location).some((v) => v !== undefined) ? location : undefined,
  };
}

// A single review from `POST /v2/trails/{id}/reviews/search`. Loose — only the
// fields the compact projection reads are named.
const RawReviewSchema = z.looseObject({
  user: z.looseObject({ name: z.string().optional() }).optional(),
  rating: z.union([z.number(), z.string()]).optional(),
  comment: z.string().optional(),
});

// Reviews envelope: the endpoint wraps results in `{ trail_reviews: [...] }`.
export const ReviewListSchema = z.looseObject({
  trail_reviews: z.array(RawReviewSchema).optional(),
});

/** A compact projection of a trail review. */
export interface ReviewSummary {
  user?: string;
  rating?: number | string;
  comment?: string;
}

/** Project a raw review into a {@link ReviewSummary}. Undefined fields are dropped by JSON.stringify. */
export function summarizeReview(raw: z.infer<typeof RawReviewSchema>): ReviewSummary {
  return { user: raw.user?.name, rating: raw.rating, comment: raw.comment };
}

/**
 * Drop undefined-valued keys via mcp-utils' `pruneUndefined`, then collapse the
 * whole object to `undefined` when nothing survives — so an all-empty nested
 * projection is omitted rather than serialized as a noisy `{}` (which
 * `pruneUndefined` alone would emit).
 */
function prune<T extends Record<string, unknown>>(obj: T): Partial<T> | undefined {
  const pruned = pruneUndefined(obj);
  return Object.keys(pruned).length > 0 ? pruned : undefined;
}

/**
 * Strip HTML tags (the feed wraps trail names in anchors), decode the entities
 * the markup leaves behind via mcp-utils' `decodeHtmlEntities` (numeric +
 * `&nbsp;/&lt;/&gt;/&quot;/&apos;`, with `&amp;` last so `&amp;lt;` → `&lt;`),
 * and collapse whitespace. Tags are removed with no separator — unlike scrape's
 * `stripHtml`, which inserts a space — to preserve this repo's feed-description
 * output exactly.
 */
function stripHtml(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Return a trimmed string, or undefined when it is null/empty/whitespace. */
function nonEmpty(s: string | null | undefined): string | undefined {
  const t = s?.trim();
  return t ? t : undefined;
}

// A single photo from `GET /v2/trails/{id}/photos` (captured 2026-07-02).
// Loose + nullish — the live records carry explicit nulls for empty fields.
const RawPhotoSchema = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  likeCount: z.number().nullish(),
  location: z
    .looseObject({ latitude: z.number().nullish(), longitude: z.number().nullish() })
    .nullish(),
  user: z.looseObject({ firstName: z.string().nullish(), lastName: z.string().nullish() }).nullish(),
  metadata: z.looseObject({ created: z.string().nullish() }).nullish(),
});
type RawPhoto = z.infer<typeof RawPhotoSchema>;

// Photos envelope: `{ photos: [...] }`.
export const PhotoListSchema = z.looseObject({
  photos: z.array(RawPhotoSchema).optional(),
});

/** A compact projection of a trail photo. */
export interface PhotoSummary {
  id?: string;
  title?: string;
  description?: string;
  likeCount?: number;
  /** Uploader's display name. */
  user?: string;
  uploadedAt?: string;
  latitude?: number;
  longitude?: number;
  /** Fetchable image URL — 302s to the CDN original. Carries the anonymous app key. */
  url?: string;
}

/**
 * Project a raw photo into a {@link PhotoSummary}. The photo records carry no
 * direct image URL; `GET /api/alltrails/photos/{id}/image?size=large&key=…`
 * (verified 2026-07-02) 302s to the CDN image and is not bot-walled, so the
 * summary derives that URL. `apiKey` is the live-captured anonymous app key
 * (`client.currentApiKey()`), not a user secret — when absent the `key` param
 * is omitted.
 */
export function summarizePhoto(raw: RawPhoto, apiKey?: string): PhotoSummary {
  const user = [nonEmpty(raw.user?.firstName), nonEmpty(raw.user?.lastName)].filter(Boolean).join(' ');
  return {
    id: raw.id === undefined ? undefined : `${raw.id}`,
    title: nonEmpty(raw.title),
    description: nonEmpty(raw.description),
    likeCount: raw.likeCount ?? undefined,
    user: user || undefined,
    uploadedAt: raw.metadata?.created ?? undefined,
    latitude: raw.location?.latitude ?? undefined,
    longitude: raw.location?.longitude ?? undefined,
    url:
      raw.id === undefined
        ? undefined
        : `${BASE_URL}/api/alltrails/photos/${encodeURIComponent(raw.id)}/image?size=large${
            apiKey === undefined ? '' : `&key=${encodeURIComponent(apiKey)}`
          }`,
  };
}

// A single result from `POST /explore/v1/search` (captured 2026-07-02). The
// records are Algolia-formatted like the listings, so RawTrailSchema covers the
// shared fields; only the search-specific extras are added here.
const RawSearchResultSchema = RawTrailSchema.extend({
  type: z.string().nullish(),
  city_name: z.string().nullish(),
  country_name: z.string().nullish(),
  duration_minutes: z.number().nullish(),
  is_closed: z.boolean().nullish(),
});
type RawSearchResult = z.infer<typeof RawSearchResultSchema>;

// Search envelope: `{ summary: { count }, searchResults: [...] }`.
export const SearchResponseSchema = z.looseObject({
  summary: z.looseObject({ count: z.number().nullish() }).nullish(),
  searchResults: z.array(RawSearchResultSchema).optional(),
});

/** {@link TrailSummary} plus the search-only fields. */
export interface SearchResultSummary extends TrailSummary {
  type?: string;
  city?: string;
  country?: string;
  durationMinutes?: number;
  closed?: boolean;
}

/**
 * Project a raw search result. Unlike the listings, search's `objectID` is the
 * prefixed `"trail-{id}"` variant, so the numeric `ID` is preferred for the id.
 */
export function summarizeSearchResult(raw: RawSearchResult): SearchResultSummary {
  const id = raw.ID ?? raw.id ?? raw.objectID;
  return {
    ...summarizeTrail(raw),
    id: id === undefined ? undefined : `${id}`,
    type: raw.type ?? undefined,
    city: raw.city_name ?? undefined,
    country: raw.country_name ?? undefined,
    durationMinutes: raw.duration_minutes ?? undefined,
    closed: raw.is_closed ?? undefined,
  };
}

// The itemData of a `feed-item` section from `GET .../feeds/{name}` (captured
// 2026-07-02). Only the projected fields are named; loose as always.
const RawFeedItemDataSchema = z.looseObject({
  itemType: z.string().nullish(),
  timestamp: z.string().nullish(),
  description: z.string().nullish(),
  user: z.looseObject({ firstName: z.string().nullish(), lastName: z.string().nullish() }).nullish(),
  trail: z
    .looseObject({
      id: z.union([z.number(), z.string()]).optional(),
      name: z.string().nullish(),
      slug: z.string().nullish(),
    })
    .nullish(),
  activity: z
    .looseObject({
      name: z.string().nullish(),
      rating: z.union([z.number(), z.string()]).nullish(),
      activity: z.looseObject({ name: z.string().nullish() }).nullish(),
      summaryStats: z
        .looseObject({
          distanceTotal: z.number().nullish(),
          duration: z.number().nullish(),
          elevationGain: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
  review: z
    .looseObject({
      rating: z.union([z.number(), z.string()]).nullish(),
      comment: z.string().nullish(),
    })
    .nullish(),
});
type RawFeedItemData = z.infer<typeof RawFeedItemDataSchema>;

// Feed page envelope: `{ sections: [{ section_type, itemData }], pageInfo }`.
export const FeedPageSchema = z.looseObject({
  sections: z
    .array(z.looseObject({ section_type: z.string().nullish(), itemData: RawFeedItemDataSchema.nullish() }))
    .optional(),
  pageInfo: z
    .looseObject({ hasNextPage: z.boolean().nullish(), nextCursor: z.string().nullish() })
    .nullish(),
});

// Feed directory envelope (`GET .../feeds` with no feed name): the available
// feeds, not the activity items themselves.
export const FeedDirectorySchema = z.looseObject({
  feeds: z
    .array(z.looseObject({ name: z.string().nullish(), displayName: z.string().nullish() }))
    .optional(),
  initialFeedHint: z.string().nullish(),
});

/** A compact projection of one activity-feed item. */
export interface FeedItemSummary {
  type?: string;
  timestamp?: string;
  /** HTML-stripped human description, e.g. "Hiked North Mountain National Trail". */
  description?: string;
  /** Actor's display name. */
  user?: string;
  trail?: { id?: string; name?: string; slug?: string };
  activity?: {
    /** Activity kind, e.g. "Hiking". */
    type?: string;
    name?: string;
    rating?: number | string;
    distanceMeters?: number;
    distanceMiles?: number;
    durationMinutes?: number;
    elevationGainMeters?: number;
    elevationGainFeet?: number;
  };
  review?: { rating?: number | string; comment?: string };
}

/** Project a feed item's itemData into a {@link FeedItemSummary}. */
export function summarizeFeedItem(raw: RawFeedItemData): FeedItemSummary {
  const user = [nonEmpty(raw.user?.firstName), nonEmpty(raw.user?.lastName)].filter(Boolean).join(' ');
  const trail = raw.trail
    ? prune({
        id: raw.trail.id === undefined ? undefined : `${raw.trail.id}`,
        name: raw.trail.name ?? undefined,
        slug: raw.trail.slug ?? undefined,
      })
    : undefined;
  const stats = raw.activity?.summaryStats;
  const activity = raw.activity
    ? prune({
        type: raw.activity.activity?.name ?? undefined,
        name: raw.activity.name ?? undefined,
        rating: raw.activity.rating ?? undefined,
        distanceMeters: stats?.distanceTotal ?? undefined,
        distanceMiles: metersToMiles(stats?.distanceTotal ?? undefined),
        // `duration` is already minutes (timeTotal/timeMoving are seconds).
        durationMinutes: stats?.duration ?? undefined,
        elevationGainMeters: stats?.elevationGain ?? undefined,
        elevationGainFeet: metersToFeet(stats?.elevationGain ?? undefined),
      })
    : undefined;
  const review = raw.review
    ? prune({ rating: raw.review.rating ?? undefined, comment: nonEmpty(raw.review.comment) })
    : undefined;
  return {
    type: raw.itemType ?? undefined,
    timestamp: raw.timestamp ?? undefined,
    description: raw.description ? nonEmpty(stripHtml(raw.description)) : undefined,
    user: user || undefined,
    trail,
    activity,
    review,
  };
}

/**
 * GET a trail-listing endpoint and return the tool result. Validates the
 * envelope (lenient — drift warns to stderr, never throws). When `compact` is
 * set and the response carried the expected `trails` array, returns a slim
 * `{ count, trails: TrailSummary[] }`; otherwise returns the raw response
 * unchanged (full detail, and the safe fallback if the shape drifted).
 */
export async function fetchTrailListing(
  client: AllTrailsClient,
  path: string,
  ctx: string,
  compact: boolean,
): Promise<ReturnType<typeof jsonResponse>> {
  const raw = await client.request('GET', path);
  const parsed = parseAllTrails(TrailListSchema, raw, ctx);
  if (compact && Array.isArray(parsed.trails)) {
    const trails = parsed.trails.map(summarizeTrail);
    return jsonResponse({ count: trails.length, trails });
  }
  return jsonResponse(raw);
}
