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

  it('compact=true unwraps the one-element envelope to a single slim object', async () => {
    const { handlers } = setup({
      trails: [{
        id: 1,
        name: 'Trail',
        length: 3218.688,
        overview: 'Nice.',
        routeType: { name: 'Loop' },
        geoloc: { lat: 1, lng: 2 }, // extra field — dropped by the projection
      }],
    });
    const result = await handlers.get('alltrails_get_trail')!({ trailId: '1', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual({
      id: '1',
      name: 'Trail',
      lengthMeters: 3218.688,
      lengthMiles: 2,
      overview: 'Nice.',
      routeType: 'Loop',
    });
  });

  it('compact=true keeps a multi-element envelope as an array', async () => {
    const { handlers } = setup({ trails: [{ id: 1 }, { id: 2 }] });
    const result = await handlers.get('alltrails_get_trail')!({ trailId: '1', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('compact=true falls back to raw when the detail shape drifted (no trails array)', async () => {
    const raw = { trail: { id: 1 } };
    const { handlers } = setup(raw);
    const result = await handlers.get('alltrails_get_trail')!({ trailId: '1', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
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

  it('returns a compact projection when compact=true', async () => {
    const { handlers } = setup({
      trail_reviews: [
        { user: { name: 'Pat' }, rating: 5, comment: 'Great', extra: 'dropped' },
        { rating: 3 },
      ],
    });
    const result = await handlers.get('alltrails_get_trail_reviews')!({ trailId: '5', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual({
      count: 2,
      reviews: [{ user: 'Pat', rating: 5, comment: 'Great' }, { rating: 3 }],
    });
  });

  it('falls back to raw when compact=true but the reviews shape drifted', async () => {
    const raw = { data: [] }; // no trail_reviews array
    const { handlers } = setup(raw);
    const result = await handlers.get('alltrails_get_trail_reviews')!({ trailId: '5', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual(raw);
  });
});

describe('alltrails_get_trail_photos', () => {
  it('GETs the photos endpoint', async () => {
    const { client, handlers } = setup({ photos: [] });
    await handlers.get('alltrails_get_trail_photos')!({ trailId: '7' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/v2/trails/7/photos');
  });

  it('returns a compact projection when compact=true, signing image urls with the captured key', async () => {
    const { client, handlers } = setup({
      photos: [
        { id: 1, title: 'View', likeCount: 2, user: { firstName: 'A', lastName: 'B' } },
        { id: 2, title: '' },
      ],
    });
    vi.spyOn(client, 'currentApiKey').mockReturnValue('live-captured-key');
    const result = await handlers.get('alltrails_get_trail_photos')!({ trailId: '7', compact: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.photos[0].title).toBe('View');
    expect(parsed.photos[0].user).toBe('A B');
    expect(parsed.photos[0].url).toContain('/api/alltrails/photos/1/image?size=large&key=live-captured-key');
    expect(parsed.photos[1]).toEqual({ id: '2', url: expect.stringContaining('/photos/2/image') });
  });

  it('falls back to raw when compact=true but the photos shape drifted', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drifted = { photos: 'nope' };
    const { handlers } = setup(drifted);
    const result = await handlers.get('alltrails_get_trail_photos')!({ trailId: '7', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual(drifted);
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('alltrails_get_trail_gpx', () => {
  it('fetches detail=offline and returns a GPX document', async () => {
    // Minimal captured-shape response; 'ol{~Ff`|uO' is not a real polyline but
    // decodes without error, which is all this wiring test needs.
    const { client, handlers } = setup({
      trails: [
        {
          name: 'Rim Trail',
          defaultMap: {
            routes: [{ lineSegments: [{ polyline: { pointsData: '_p~iF~ps|U', indexedElevationData: null } }] }],
          },
        },
      ],
    });
    const result = await handlers.get('alltrails_get_trail_gpx')!({ trailId: '99' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/v3/trails/99?detail=offline');
    expect(result.content[0].text).toContain('<gpx version="1.1"');
    expect(result.content[0].text).toContain('<name>Rim Trail</name>');
  });

  it('surfaces the no-geometry error when the shape drifted', async () => {
    const { handlers } = setup({ trails: [{ name: 'X' }] });
    await expect(handlers.get('alltrails_get_trail_gpx')!({ trailId: '99' })).rejects.toThrow(/no route geometry/i);
  });
});

describe('alltrails_get_trail_weather', () => {
  it('GETs the weather overview endpoint', async () => {
    const { client, handlers } = setup({ weather: {} });
    await handlers.get('alltrails_get_trail_weather')!({ trailId: '7' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/weather-service/v2/trails/7/overview');
  });
});
