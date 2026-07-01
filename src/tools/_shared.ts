import { rawTextResult, textResult } from '@chrischall/mcp-utils';
import { z } from 'zod';
import type { AllTrailsClient } from '../client.js';
import { getConfiguredUserId } from '../config.js';
import { parseAllTrails } from '../validate.js';

// Pretty-printed JSON tool result. Thin wrapper over @chrischall/mcp-utils'
// `textResult` so the rest of the codebase keeps the local name.
export const jsonResponse = textResult;

// Raw-string tool result. Wrapper over @chrischall/mcp-utils' `rawTextResult`.
export const textResponse = rawTextResult;

// `GET /api/alltrails/me` returns the signed-in user; we only read the id.
// Loose: every other field passes through untouched.
const MeSchema = z.looseObject({
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
  const id = me?.user?.id ?? me?.id;
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
  return {
    ...summarizeTrail(raw),
    overview: raw.overview,
    routeType: raw.routeType?.name,
    location: raw.location && {
      latitude: raw.location.latitude,
      longitude: raw.location.longitude,
      city: raw.location.city,
      region: raw.location.region,
      country: raw.location.country,
    },
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
