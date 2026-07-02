import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AllTrailsClient } from '../client.js';
import { parseAllTrails } from '../validate.js';
import { fetchTrailListing, jsonResponse, SearchResponseSchema, summarizeSearchResult } from './_shared.js';

// The record types the alltrails.com explore search box requests (its request
// body was captured verbatim 2026-07-02); also the accepted values for the
// tool's `types` arg.
const SUGGESTION_RECORD_TYPES = [
  'country', 'state', 'city', 'area', 'poi', 'trail', 'guide', 'filter', 'list', 'sponsored_list',
] as const;

// Discovery tools: full-text/geographic search plus bulk listing by
// state/country. All read-only.
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
        .describe('Record types to return (default: all). e.g. ["trail"] for trails only')
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

  server.registerTool('alltrails_list_trails_by_state', {
    description:
      'List trails within a US state (or other region) by its numeric AllTrails state id. Returns a rich, ' +
      'paginated listing (name, slug, length, elevation gain, difficulty, rating, features, activities). ' +
      'Set compact=true to get a slimmed summary per trail (id, name, length, difficulty, rating, …) — ' +
      'much smaller output when you just need to browse or rank.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      stateId: z.string().describe('Numeric AllTrails state/region id'),
      page: z.number().int().positive().describe('Page number (default 1)').optional(),
      perPage: z.number().int().positive().describe('Results per page (default 25, max ~100)').optional(),
      compact: z.boolean().describe('Return a slim summary per trail instead of the full records (default false)').optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams({
      page: String(args.page ?? 1),
      per_page: String(args.perPage ?? 25),
      algolia_formatted: 'true',
    });
    const path = `/api/alltrails/locations/states/${encodeURIComponent(args.stateId)}/trails?${params.toString()}`;
    return fetchTrailListing(client, path, 'GET /api/alltrails/locations/states/{id}/trails', args.compact ?? false);
  });

  server.registerTool('alltrails_list_trails_by_country', {
    description:
      'List trails within a country by its numeric AllTrails country id (e.g. 313 = United States). Paginated. ' +
      'Set compact=true to get a slimmed summary per trail (id, name, length, difficulty, rating, …).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      countryId: z.string().describe('Numeric AllTrails country id (e.g. "313" for the US)'),
      page: z.number().int().positive().describe('Page number (default 1)').optional(),
      perPage: z.number().int().positive().describe('Results per page (default 25, max ~100)').optional(),
      compact: z.boolean().describe('Return a slim summary per trail instead of the full records (default false)').optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams({
      page: String(args.page ?? 1),
      per_page: String(args.perPage ?? 25),
      algolia_formatted: 'true',
    });
    const path = `/api/alltrails/locations/countries/${encodeURIComponent(args.countryId)}/trails?${params.toString()}`;
    return fetchTrailListing(client, path, 'GET /api/alltrails/locations/countries/{id}/trails', args.compact ?? false);
  });
}
