import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { AllTrailsClient } from '../../src/client.js';
import { registerExploreTools } from '../../src/tools/explore.js';
import { registerTrailTools } from '../../src/tools/trails.js';
import { registerUserTools } from '../../src/tools/user.js';

// Registration-level checks across every data tool: the configs the handlers
// are registered with (input schemas, annotations), not the handlers.
type ToolConfig = { inputSchema?: z.ZodType; annotations?: Record<string, unknown>; title?: string };

function registeredConfigs(): Map<string, ToolConfig> {
  const client = new AllTrailsClient();
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const configs = new Map<string, ToolConfig>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, cfg: unknown) => {
    configs.set(name, cfg as ToolConfig);
    return undefined as never;
  });
  registerTrailTools(server, client);
  registerExploreTools(server, client);
  registerUserTools(server, client);
  return configs;
}

afterEach(() => vi.restoreAllMocks());

// Every id that is interpolated into a request path. A non-numeric id — '..'
// in particular, which encodeURIComponent leaves alone and the in-tab fetch
// normalises as a dot segment — would retarget the request at another
// same-origin endpoint.
const ID_ARGS: Array<[tool: string, arg: string]> = [
  ['alltrails_get_trail', 'trailId'],
  ['alltrails_get_trail_reviews', 'trailId'],
  ['alltrails_get_trail_photos', 'trailId'],
  ['alltrails_get_trail_gpx', 'trailId'],
  ['alltrails_get_trail_weather', 'trailId'],
  ['alltrails_get_list_items', 'listId'],
  ['alltrails_list_user_lists', 'userId'],
  ['alltrails_list_completed_trails', 'userId'],
  ['alltrails_get_activity_feed', 'userId'],
];

describe('path id arguments', () => {
  const configs = registeredConfigs();

  it.each(ID_ARGS)('%s accepts a numeric %s', (tool, arg) => {
    const schema = configs.get(tool)!.inputSchema!;
    expect(schema.safeParse({ [arg]: '10236086' }).success).toBe(true);
  });

  it.each(ID_ARGS)('%s rejects a dot-segment / non-numeric %s', (tool, arg) => {
    const schema = configs.get(tool)!.inputSchema!;
    for (const bad of ['..', '.', '../reviews', '12/..', 'abc', '', ' 12']) {
      expect(schema.safeParse({ [arg]: bad }).success, `${tool} ${arg}=${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe('tool annotations', () => {
  const configs = registeredConfigs();

  it('registers all twelve data tools', () => {
    expect(configs.size).toBe(12);
  });

  it.each([...registeredConfigs().keys()])(
    '%s declares itself an idempotent, open-world read with a title',
    (tool) => {
      const cfg = configs.get(tool)!;
      expect(cfg.annotations).toEqual({ readOnlyHint: true, idempotentHint: true, openWorldHint: true });
      expect(typeof cfg.title).toBe('string');
      expect(cfg.title!.length).toBeGreaterThan(0);
    },
  );
});

// client.request returns null for an empty 2xx body. The compact projections
// used to dereference the lenient-parse result unguarded and throw an opaque
// "Cannot read properties of null" TypeError instead of passing the empty
// payload through like view:"full" does.
describe('empty response body', () => {
  function handlersReturningNull() {
    const client = new AllTrailsClient();
    vi.spyOn(client, 'request').mockResolvedValue(null);
    const server = new McpServer({ name: 'test', version: '0.0.0' });
    const handlers = new Map<string, (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>>();
    vi.spyOn(server, 'registerTool').mockImplementation((name: string, _cfg: unknown, cb: unknown) => {
      handlers.set(name, cb as never);
      return undefined as never;
    });
    registerTrailTools(server, client);
    registerExploreTools(server, client);
    registerUserTools(server, client);
    return handlers;
  }

  it.each<[string, Record<string, unknown>]>([
    ['alltrails_get_trail', { trailId: '1' }],
    ['alltrails_get_trail_reviews', { trailId: '1' }],
    ['alltrails_get_trail_photos', { trailId: '1' }],
    ['alltrails_search', { query: 'x' }],
    ['alltrails_search', {}],
    ['alltrails_resolve_location', { query: 'x' }],
    ['alltrails_get_list_items', { listId: '1' }],
    ['alltrails_get_activity_feed', { userId: '1' }],
    ['alltrails_get_activity_feed', { userId: '1', feed: 'personal' }],
  ])('%s %j passes an empty body through instead of throwing', async (tool, args) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handlersReturningNull().get(tool)!(args);
    expect(JSON.parse(result.content[0].text)).toBeNull();
  });
});
