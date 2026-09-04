import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AllTrailsClient } from '../../src/client.js';
import { registerTrailTools } from '../../src/tools/trails.js';
import { registerExploreTools } from '../../src/tools/explore.js';
import { registerUserTools } from '../../src/tools/user.js';

// `view` is OUR vocabulary. It names the shape we hand the caller back, and
// AllTrails has never heard of it — unlike `detail` (basic/medium/offline),
// which IS an upstream query param on the same tool. That collision is the
// whole reason the fleet parameter is called `view`, and it is also what makes
// leaking it easy to miss: one of the two arguments genuinely belongs on the
// wire.
//
// Every handler in this repo takes `async (args)` and builds its request body
// field by field, which is what keeps `args.view` out of it. That is a
// convention, not a type error — a later `client.request('POST', path, args)`
// or `{ ...args }` would compile, pass every other test, and start sending
// `view=compact` to AllTrails. Two sibling repos shipped exactly that. So
// assert the property itself.
type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function setup() {
  const client = new AllTrailsClient();
  const request = vi.spyOn(client, 'request').mockResolvedValue({});
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, ToolHandler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _cfg: unknown, cb: unknown) => {
    handlers.set(name, cb as ToolHandler);
    return undefined as never;
  });
  registerTrailTools(server, client);
  registerExploreTools(server, client);
  registerUserTools(server, client);
  return { request, handlers };
}

afterEach(() => vi.restoreAllMocks());

/** Every tool that takes `view`, with arguments that reach a real request. */
const VIEW_TOOLS: Array<[label: string, tool: string, args: Record<string, unknown>]> = [
  ['get_trail', 'alltrails_get_trail', { trailId: '1' }],
  ['get_trail (offline)', 'alltrails_get_trail', { trailId: '1', detail: 'offline' }],
  ['get_trail_reviews', 'alltrails_get_trail_reviews', { trailId: '1' }],
  ['get_trail_photos', 'alltrails_get_trail_photos', { trailId: '1' }],
  ['search (query)', 'alltrails_search', { query: 'zion' }],
  ['search (no-query fallback)', 'alltrails_search', { lat: 1, lng: 2 }],
  ['get_list_items', 'alltrails_get_list_items', { listId: '5' }],
  ['get_activity_feed (directory)', 'alltrails_get_activity_feed', { userId: '9' }],
  ['get_activity_feed (feed)', 'alltrails_get_activity_feed', { userId: '9', feed: 'personal', maxItems: 5, cursor: 'c' }],
];

describe('`view` never reaches AllTrails', () => {
  for (const [label, tool, args] of VIEW_TOOLS) {
    for (const view of ['compact', 'full'] as const) {
      it(`${label} keeps view:"${view}" out of the request`, async () => {
        const { request, handlers } = setup();
        await handlers.get(tool)!({ ...args, view });

        expect(request).toHaveBeenCalled();
        for (const call of request.mock.calls) {
          const [, path, body] = call as [string, string, unknown];

          // Not in the URL's QUERY STRING. Substring-matching the whole path
          // is wrong and this test caught it: `/reviews/search` contains
          // "view". Parse the params and check the keys and values.
          const query = new URLSearchParams(path.split('?')[1] ?? '');
          expect([...query.keys()]).not.toContain('view');
          for (const value of query.values()) {
            expect(value).not.toBe('compact');
            expect(value).not.toBe('full');
          }

          // Not in the body. `detail` is the one shape-ish argument that IS
          // allowed upstream, and it never carries a rung name.
          if (body === undefined || body === null) continue;
          const fields = body as Record<string, unknown>;
          expect(Object.keys(fields)).not.toContain('view');
          expect(Object.values(fields)).not.toContain('compact');
          expect(Object.values(fields)).not.toContain('full');
        }
      });
    }
  }

  it('`detail` still DOES reach AllTrails — the guard above must not overreach', async () => {
    const { request, handlers } = setup();
    await handlers.get('alltrails_get_trail')!({ trailId: '1', detail: 'offline', view: 'full' });
    expect(request).toHaveBeenCalledWith('GET', '/api/alltrails/v3/trails/1?detail=offline');
  });
});
