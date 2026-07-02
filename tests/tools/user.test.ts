import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AllTrailsClient } from '../../src/client.js';
import { registerUserTools } from '../../src/tools/user.js';

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
  registerUserTools(server, client);
  return { client, handlers };
}

afterEach(() => {
  delete process.env.ALLTRAILS_USER_ID;
  vi.restoreAllMocks();
});

describe('alltrails_get_profile', () => {
  it('GETs /api/alltrails/me', async () => {
    const me = { user: { id: 1, name: 'Chris' } };
    const { client, handlers } = setup(me);
    const result = await handlers.get('alltrails_get_profile')!({});
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/me');
    expect(JSON.parse(result.content[0].text)).toEqual(me);
  });
});

describe('alltrails_list_user_lists', () => {
  it('uses an explicit userId without a /me lookup', async () => {
    const { client, handlers } = setup({ lists: [] });
    await handlers.get('alltrails_list_user_lists')!({ userId: '888' });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/users/888/lists');
  });

  it('resolves the signed-in user via /me when no userId is given', async () => {
    const { client, handlers } = setup({ user: { id: 42 } });
    await handlers.get('alltrails_list_user_lists')!({});
    expect(client.request).toHaveBeenNthCalledWith(1, 'GET', '/api/alltrails/me');
    expect(client.request).toHaveBeenNthCalledWith(2, 'GET', '/api/alltrails/users/42/lists');
  });
});

describe('alltrails_list_completed_trails', () => {
  it('GETs the completed-trails endpoint for the resolved user', async () => {
    process.env.ALLTRAILS_USER_ID = '333';
    const { client, handlers } = setup({ trails: [] });
    await handlers.get('alltrails_list_completed_trails')!({});
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/users/333/trails/completed');
  });
});

describe('alltrails_get_activity_feed', () => {
  it('GETs the community feed endpoint for the given user', async () => {
    const { client, handlers } = setup({ feed: [] });
    await handlers.get('alltrails_get_activity_feed')!({ userId: '12' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/community/blazes/v0/users/12/feeds');
  });
});
