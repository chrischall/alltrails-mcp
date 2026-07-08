import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AllTrailsClient } from '../../src/client.js';
import { registerExploreTools } from '../../src/tools/explore.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function setup(returnValue: unknown) {
  const client = new AllTrailsClient();
  vi.spyOn(client, 'request').mockResolvedValue(returnValue);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _cfg: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerExploreTools(server, client);
  return { client, handlers };
}

afterEach(() => vi.restoreAllMocks());

// The full record-type list the alltrails.com explore search box sends
// (captured 2026-07-02).
const ALL_RECORD_TYPES = [
  'country', 'state', 'city', 'area', 'poi', 'trail', 'guide', 'filter', 'list', 'sponsored_list',
];

describe('alltrails_search', () => {
  it('routes a free-text query to the suggestions endpoint with the captured body shape', async () => {
    const { client, handlers } = setup({ searchResults: [] });
    await handlers.get('alltrails_search')!({ query: 'angels landing', limit: 5 });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/suggestions', {
      query: 'angels landing',
      limit: 5,
      recordTypesToReturn: ALL_RECORD_TYPES,
    });
  });

  it('does not send lat/lng on the suggestions path (the endpoint ignores them)', async () => {
    const { client, handlers } = setup({ searchResults: [] });
    await handlers.get('alltrails_search')!({ query: 'waterfall', lat: 45.5, lng: -122.6 });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/suggestions', {
      query: 'waterfall',
      limit: 20,
      recordTypesToReturn: ALL_RECORD_TYPES,
    });
  });

  it('narrows recordTypesToReturn when types is provided', async () => {
    const { client, handlers } = setup({ searchResults: [] });
    await handlers.get('alltrails_search')!({ query: 'zion', types: ['trail', 'area'] });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/suggestions', {
      query: 'zion',
      limit: 20,
      recordTypesToReturn: ['trail', 'area'],
    });
  });

  it('falls back to the legacy search endpoint with only a limit when no query is given', async () => {
    const { client, handlers } = setup({ searchResults: [] });
    await handlers.get('alltrails_search')!({});
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/search', { limit: 20 });
  });

  it('includes lat/lng on the legacy path even when they are zero (falsy but defined)', async () => {
    const { client, handlers } = setup({ searchResults: [] });
    await handlers.get('alltrails_search')!({ lat: 0, lng: 0 });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/search', {
      limit: 20,
      lat: 0,
      lng: 0,
    });
  });

  it('compact=true projects suggestions results and enforces the limit client-side', async () => {
    const { handlers } = setup({
      summary: { count: 500, displayText: '500+ trails' },
      searchResults: [
        { ID: 1, objectID: 'trail-1', type: 'trail', name: 'A', length: 1609.344, city_name: 'LA' },
        { ID: 2, objectID: 'trail-2', type: 'trail', name: 'B' },
        { ID: 3, objectID: 'trail-3', type: 'trail', name: 'C' },
      ],
    });
    const result = await handlers.get('alltrails_search')!({ query: 'park', limit: 2, compact: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalCount).toBe(500);
    expect(parsed.count).toBe(2);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0]).toEqual({
      id: '1', type: 'trail', name: 'A', lengthMeters: 1609.344, lengthMiles: 1, city: 'LA',
    });
  });

  it('compact=true works on the legacy no-query path and omits totalCount when summary is absent', async () => {
    const { client, handlers } = setup({ searchResults: [{ ID: 1, name: 'A' }] });
    const result = await handlers.get('alltrails_search')!({ compact: true });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/search', { limit: 20 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalCount).toBeUndefined();
    expect(parsed.count).toBe(1);
  });

  it('compact=true falls back to raw when the response shape drifted', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drifted = { searchResults: 'nope' };
    const { handlers } = setup(drifted);
    const result = await handlers.get('alltrails_search')!({ query: 'park', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual(drifted);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('alltrails_list_trails_by_state', () => {
  it('defaults page/perPage and sets algolia_formatted', async () => {
    const { client, handlers } = setup({ trails: [] });
    await handlers.get('alltrails_list_trails_by_state')!({ stateId: '99' });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/api/alltrails/locations/states/99/trails?page=1&per_page=25&algolia_formatted=true',
    );
  });

  it('passes explicit paging', async () => {
    const { client, handlers } = setup({ trails: [] });
    await handlers.get('alltrails_list_trails_by_state')!({ stateId: '99', page: 3, perPage: 100 });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/api/alltrails/locations/states/99/trails?page=3&per_page=100&algolia_formatted=true',
    );
  });

  it('returns a compact summary when compact=true', async () => {
    const { handlers } = setup({ trails: [{ objectID: 5, name: 'Ridge', avg_rating: 4.2 }] });
    const result = await handlers.get('alltrails_list_trails_by_state')!({ stateId: '99', compact: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({ count: 1, trails: [{ id: '5', name: 'Ridge', rating: 4.2 }] });
  });
});

describe('alltrails_list_trails_by_country', () => {
  it('defaults page/perPage', async () => {
    const { client, handlers } = setup({ trails: [] });
    await handlers.get('alltrails_list_trails_by_country')!({ countryId: '313' });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/api/alltrails/locations/countries/313/trails?page=1&per_page=25&algolia_formatted=true',
    );
  });

  it('passes explicit paging', async () => {
    const { client, handlers } = setup({ trails: [] });
    await handlers.get('alltrails_list_trails_by_country')!({ countryId: '313', page: 2, perPage: 50 });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/api/alltrails/locations/countries/313/trails?page=2&per_page=50&algolia_formatted=true',
    );
  });

  it('returns a compact summary when compact=true', async () => {
    const { handlers } = setup({ trails: [{ ID: 9, name: 'Loop' }] });
    const result = await handlers.get('alltrails_list_trails_by_country')!({ countryId: '313', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual({ count: 1, trails: [{ id: '9', name: 'Loop' }] });
  });
});

describe('alltrails_resolve_location', () => {
  it('POSTs the suggestions endpoint with location record types by default', async () => {
    const { client, handlers } = setup({ searchResults: [] });
    await handlers.get('alltrails_resolve_location')!({ query: 'portland' });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/suggestions', {
      query: 'portland',
      limit: 10,
      recordTypesToReturn: ['country', 'state', 'city', 'area', 'poi'],
    });
  });

  it('honors explicit kinds and limit', async () => {
    const { client, handlers } = setup({ searchResults: [] });
    await handlers.get('alltrails_resolve_location')!({ query: 'oregon', kinds: ['state', 'city'], limit: 3 });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/suggestions', {
      query: 'oregon',
      limit: 3,
      recordTypesToReturn: ['state', 'city'],
    });
  });

  it('projects the resolved locations and truncates to limit', async () => {
    const { handlers } = setup({
      searchResults: [
        { type: 'place', location_type: 'city', ID: 6641, objectID: 'cityo-6641', slug: 'us/oregon/portland', name: 'Portland', state_name: 'Oregon', country_name: 'United States', _geoloc: { lat: 45.52, lng: -122.67 }, location_label: 'Oregon, United States' },
        { type: 'place', location_type: 'state', ID: 38, objectID: 'state-38', slug: 'us/oregon', name: 'Oregon' },
        { type: 'place', location_type: 'city', ID: 99, name: 'Portlandia' },
      ],
    });
    const result = await handlers.get('alltrails_resolve_location')!({ query: 'portland', limit: 2 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.locations[0]).toEqual({
      name: 'Portland', kind: 'city', id: '6641', objectID: 'cityo-6641', slug: 'us/oregon/portland',
      latitude: 45.52, longitude: -122.67, region: 'Oregon', country: 'United States', label: 'Oregon, United States',
    });
    expect(parsed.locations[1]).toEqual({ name: 'Oregon', kind: 'state', id: '38', objectID: 'state-38', slug: 'us/oregon' });
  });

  it('falls back to the raw response when the shape drifted', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drifted = { searchResults: 'nope' };
    const { handlers } = setup(drifted);
    const result = await handlers.get('alltrails_resolve_location')!({ query: 'x' });
    expect(JSON.parse(result.content[0].text)).toEqual(drifted);
    expect(errSpy).toHaveBeenCalled();
  });
});
