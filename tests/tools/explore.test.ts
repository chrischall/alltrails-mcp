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

describe('alltrails_search', () => {
  it('POSTs only a default limit when no filters are given', async () => {
    const { client, handlers } = setup({ results: [] });
    await handlers.get('alltrails_search')!({});
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/search', { limit: 20 });
  });

  it('includes query + lat/lng + limit when provided', async () => {
    const { client, handlers } = setup({ results: [] });
    await handlers.get('alltrails_search')!({ query: 'waterfall', lat: 45.5, lng: -122.6, limit: 5 });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/search', {
      limit: 5,
      q: 'waterfall',
      lat: 45.5,
      lng: -122.6,
    });
  });

  it('includes lat/lng even when they are zero (falsy but defined)', async () => {
    const { client, handlers } = setup({ results: [] });
    await handlers.get('alltrails_search')!({ lat: 0, lng: 0 });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/explore/v1/search', {
      limit: 20,
      lat: 0,
      lng: 0,
    });
  });

  it('compact=true projects searchResults and enforces the limit client-side', async () => {
    // The live endpoint ignores the body limit (500 results for limit=5), so
    // compact mode truncates locally.
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

  it('compact=true omits totalCount when the summary block is absent', async () => {
    const { handlers } = setup({ searchResults: [{ ID: 1, name: 'A' }] });
    const result = await handlers.get('alltrails_search')!({ compact: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.totalCount).toBeUndefined();
    expect(parsed.count).toBe(1);
  });

  it('compact=true falls back to raw when the search shape drifted', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drifted = { searchResults: 'nope' };
    const { handlers } = setup(drifted);
    const result = await handlers.get('alltrails_search')!({ compact: true });
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
