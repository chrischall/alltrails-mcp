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
