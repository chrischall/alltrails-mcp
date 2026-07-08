import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AllTrailsClient } from '../client.js';
import { parseAllTrails } from '../validate.js';
import {
  jsonResponse,
  LocationSuggestSchema,
  SearchResponseSchema,
  summarizeLocation,
  summarizeSearchResult,
} from './_shared.js';

// The location record types the geocoder requests (a subset of the suggestions
// record types — places and points of interest, not trails/guides/lists).
const LOCATION_RECORD_TYPES = ['country', 'state', 'city', 'area', 'poi'] as const;

// The record types the alltrails.com explore search box requests (its request
// body was captured verbatim 2026-07-02); also the accepted values for the
// tool's `types` arg.
const SUGGESTION_RECORD_TYPES = [
  'country', 'state', 'city', 'area', 'poi', 'trail', 'guide', 'filter', 'list', 'sponsored_list',
] as const;

// Discovery tools: full-text search by name plus place-name resolution. All
// read-only. (The former list-by-state/country tools were removed once
// AllTrails retired the `/locations/{id}/trails` endpoint — see CLAUDE.md.)
export function registerExploreTools(server: McpServer, client: AllTrailsClient): void {
  server.registerTool('alltrails_search', {
    description:
      'Search AllTrails by name. A free-text query goes to the suggestions endpoint the alltrails.com ' +
      'search box itself uses — relevance is good and the limit is honored. Results may mix record types ' +
      '(trail, poi, area, city, …); pass types=["trail"] to narrow. lat/lng are accepted for backward ' +
      'compatibility but verified ignored by the API (2026-07-02) — results carry an implicit ' +
      'account/IP geo bias instead. Without a query this falls back to the legacy explore search, which ' +
      'returns trails anchored to the signed-in account\'s location. Set compact=true (strongly ' +
      'recommended) for slim summaries capped at limit client-side.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Free-text search, e.g. "angels landing" or "waterfall trails"').optional(),
      types: z
        .array(z.enum(SUGGESTION_RECORD_TYPES))
        .describe('Record types to return (default: all). e.g. ["trail"] for trails only. Only applied when query is provided; silently ignored on the no-query legacy browse fallback.')
        .optional(),
      lat: z.number().describe('Deprecated — the API ignores it (verified 2026-07-02)').optional(),
      lng: z.number().describe('Deprecated — the API ignores it (verified 2026-07-02)').optional(),
      limit: z.number().int().positive().describe('Max results to return (default 20)').optional(),
      compact: z
        .boolean()
        .describe('Return slim per-result summaries capped at limit instead of the full records (default false)')
        .optional(),
    },
  }, async (args) => {
    const limit = args.limit ?? 20;
    let raw: unknown;
    let ctx: string;
    if (args.query !== undefined) {
      // The captured web-client body shape: { query, limit, recordTypesToReturn }.
      // Unlike /explore/v1/search, this endpoint actually applies the free text.
      ctx = 'POST /api/alltrails/explore/v1/suggestions';
      raw = await client.request('POST', '/api/alltrails/explore/v1/suggestions', {
        query: args.query,
        limit,
        recordTypesToReturn: args.types ?? [...SUGGESTION_RECORD_TYPES],
      });
    } else {
      // Legacy no-query browse. The endpoint ignores every body param except
      // limit (probed 2026-07-02); lat/lng are still forwarded for
      // backward compatibility.
      ctx = 'POST /api/alltrails/explore/v1/search';
      const body: Record<string, unknown> = { limit };
      if (args.lat !== undefined) body.lat = args.lat;
      if (args.lng !== undefined) body.lng = args.lng;
      raw = await client.request('POST', '/api/alltrails/explore/v1/search', body);
    }
    if (args.compact) {
      const parsed = parseAllTrails(SearchResponseSchema, raw, ctx);
      if (Array.isArray(parsed.searchResults)) {
        // Truncate locally: suggestions honors the limit, but the legacy
        // endpoint has been seen returning hundreds regardless.
        const results = parsed.searchResults.slice(0, limit).map(summarizeSearchResult);
        return jsonResponse({ totalCount: parsed.summary?.count ?? undefined, count: results.length, results });
      }
    }
    return jsonResponse(raw);
  });

  server.registerTool('alltrails_resolve_location', {
    description:
      'Resolve a place name to AllTrails location records — country / state / city / area / point of ' +
      'interest — with each one\'s kind, coordinates, URL slug, and disambiguation label. Useful for ' +
      'pinning down which "Oregon" (state vs the towns) or getting a place\'s coordinates/slug. ' +
      'NOTE: the returned id is an Algolia search id and is NOT the id the trail-listing tools take; ' +
      'to find trails for a place, feed the resolved name back into alltrails_search.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Place name to resolve, e.g. "portland oregon" or "zion"'),
      kinds: z
        .array(z.enum(LOCATION_RECORD_TYPES))
        .describe('Which place kinds to return (default: all — country, state, city, area, poi)')
        .optional(),
      limit: z.number().int().positive().describe('Max results to return (default 10)').optional(),
    },
  }, async (args) => {
    const limit = args.limit ?? 10;
    const raw = await client.request('POST', '/api/alltrails/explore/v1/suggestions', {
      query: args.query,
      limit,
      recordTypesToReturn: args.kinds ?? [...LOCATION_RECORD_TYPES],
    });
    const parsed = parseAllTrails(LocationSuggestSchema, raw, 'POST /api/alltrails/explore/v1/suggestions (locations)');
    if (Array.isArray(parsed.searchResults)) {
      const locations = parsed.searchResults.slice(0, limit).map(summarizeLocation);
      return jsonResponse({ count: locations.length, locations });
    }
    return jsonResponse(raw);
  });
}
