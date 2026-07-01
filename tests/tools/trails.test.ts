import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AllTrailsClient } from '../../src/client.js';
import { registerTrailTools } from '../../src/tools/trails.js';

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
  registerTrailTools(server, client);
  return { client, handlers };
}

afterEach(() => vi.restoreAllMocks());

describe('alltrails_get_trail', () => {
  it('defaults detail to medium', async () => {
    const { client, handlers } = setup({ trails: [] });
    await handlers.get('alltrails_get_trail')!({ trailId: '123' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/v3/trails/123?detail=medium');
  });

  it('passes an explicit detail level and url-encodes the id', async () => {
    const { client, handlers } = setup({ trails: [] });
    await handlers.get('alltrails_get_trail')!({ trailId: 'a/b', detail: 'offline' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/v3/trails/a%2Fb?detail=offline');
  });

  it('returns the payload as JSON content', async () => {
    const trail = { trails: [{ id: 1, name: 'Trail' }] };
    const { handlers } = setup(trail);
    const result = await handlers.get('alltrails_get_trail')!({ trailId: '1' });
    expect(JSON.parse(result.content[0].text)).toEqual(trail);
  });
});

describe('alltrails_get_trail_reviews', () => {
  it('POSTs with a default limit of 20', async () => {
    const { client, handlers } = setup({ trail_reviews: [] });
    await handlers.get('alltrails_get_trail_reviews')!({ trailId: '5' });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/v2/trails/5/reviews/search', { limit: 20 });
  });

  it('passes an explicit limit', async () => {
    const { client, handlers } = setup({ trail_reviews: [] });
    await handlers.get('alltrails_get_trail_reviews')!({ trailId: '5', limit: 3 });
    expect(client.request).toHaveBeenCalledWith('POST', '/api/alltrails/v2/trails/5/reviews/search', { limit: 3 });
  });
});

describe('alltrails_get_trail_photos', () => {
  it('GETs the photos endpoint', async () => {
    const { client, handlers } = setup({ photos: [] });
    await handlers.get('alltrails_get_trail_photos')!({ trailId: '7' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/v2/trails/7/photos');
  });
});

describe('alltrails_get_trail_weather', () => {
  it('GETs the weather overview endpoint', async () => {
    const { client, handlers } = setup({ weather: {} });
    await handlers.get('alltrails_get_trail_weather')!({ trailId: '7' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/weather-service/v2/trails/7/overview');
  });
});
