import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AllTrailsClient } from '../client.js';
import { jsonResponse } from './_shared.js';

// Discovery tools: full-text/geographic search plus bulk listing by
// state/country. All read-only.
export function registerExploreTools(server: McpServer, client: AllTrailsClient): void {
  server.registerTool('alltrails_search', {
    description:
      'Search AllTrails for trails. Provide a free-text query (place or trail name) and/or a lat/lng to ' +
      'bias results geographically. Note: this hits AllTrails\' internal explore endpoint; the exact ' +
      'response shape is undocumented and may change.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      query: z.string().describe('Free-text search, e.g. "waterfall trails near Portland"').optional(),
      lat: z.number().describe('Latitude to bias results toward').optional(),
      lng: z.number().describe('Longitude to bias results toward').optional(),
      limit: z.number().int().positive().describe('Max results to return (default 20)').optional(),
    },
  }, async (args) => {
    const body: Record<string, unknown> = { limit: args.limit ?? 20 };
    if (args.query !== undefined) body.q = args.query;
    if (args.lat !== undefined) body.lat = args.lat;
    if (args.lng !== undefined) body.lng = args.lng;
    const data = await client.request('POST', '/api/alltrails/explore/v1/search', body);
    return jsonResponse(data);
  });

  server.registerTool('alltrails_list_trails_by_state', {
    description:
      'List trails within a US state (or other region) by its numeric AllTrails state id. Returns a rich, ' +
      'paginated listing (name, slug, length, elevation gain, difficulty, rating, features, activities).',
    annotations: { readOnlyHint: true },
    inputSchema: {
      stateId: z.string().describe('Numeric AllTrails state/region id'),
      page: z.number().int().positive().describe('Page number (default 1)').optional(),
      perPage: z.number().int().positive().describe('Results per page (default 25, max ~100)').optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams({
      page: String(args.page ?? 1),
      per_page: String(args.perPage ?? 25),
      algolia_formatted: 'true',
    });
    const data = await client.request(
      'GET',
      `/api/alltrails/locations/states/${encodeURIComponent(args.stateId)}/trails?${params.toString()}`,
    );
    return jsonResponse(data);
  });

  server.registerTool('alltrails_list_trails_by_country', {
    description:
      'List trails within a country by its numeric AllTrails country id (e.g. 313 = United States). Paginated.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      countryId: z.string().describe('Numeric AllTrails country id (e.g. "313" for the US)'),
      page: z.number().int().positive().describe('Page number (default 1)').optional(),
      perPage: z.number().int().positive().describe('Results per page (default 25, max ~100)').optional(),
    },
  }, async (args) => {
    const params = new URLSearchParams({
      page: String(args.page ?? 1),
      per_page: String(args.perPage ?? 25),
      algolia_formatted: 'true',
    });
    const data = await client.request(
      'GET',
      `/api/alltrails/locations/countries/${encodeURIComponent(args.countryId)}/trails?${params.toString()}`,
    );
    return jsonResponse(data);
  });
}
