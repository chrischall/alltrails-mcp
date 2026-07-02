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
  it('GETs the feed directory when no feed is selected', async () => {
    const { client, handlers } = setup({ feeds: [] });
    await handlers.get('alltrails_get_activity_feed')!({ userId: '12' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/community/blazes/v0/users/12/feeds');
  });

  it('follows a named feed, passing maxItems and cursor as query params', async () => {
    const { client, handlers } = setup({ sections: [] });
    await handlers.get('alltrails_get_activity_feed')!({
      userId: '12',
      feed: 'local',
      maxItems: 10,
      cursor: 'BAAIbnVsbAAAAAA=',
    });
    expect(client.request).toHaveBeenCalledWith(
      'GET',
      '/api/alltrails/community/blazes/v0/users/12/feeds/local?maxItems=10&cursor=BAAIbnVsbAAAAAA%3D',
    );
  });

  it('follows a named feed with no query params when none are given', async () => {
    const { client, handlers } = setup({ sections: [] });
    await handlers.get('alltrails_get_activity_feed')!({ userId: '12', feed: 'timeline' });
    expect(client.request).toHaveBeenCalledWith('GET', '/api/alltrails/community/blazes/v0/users/12/feeds/timeline');
  });

  it('compact=true projects feed items with paging info', async () => {
    // Shape captured 2026-07-02 from GET .../feeds/local.
    const { handlers } = setup({
      sections: [
        {
          section_type: 'feed-item',
          cursor: 'c1',
          itemData: {
            itemType: 'activity:created',
            timestamp: '2026-06-25T13:38:58.000Z',
            user: { firstName: 'Jade', lastName: 'Sandoval' },
            trail: { id: 10305376, name: 'North Mountain National Trail' },
          },
        },
        { section_type: 'banner' }, // non-item section — skipped
      ],
      pageInfo: { hasNextPage: true, itemCount: 1, nextCursor: 'c2' },
    });
    const result = await handlers.get('alltrails_get_activity_feed')!({ userId: '12', feed: 'local', compact: true });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(1);
    expect(parsed.hasNextPage).toBe(true);
    expect(parsed.nextCursor).toBe('c2');
    expect(parsed.items[0]).toEqual({
      type: 'activity:created',
      timestamp: '2026-06-25T13:38:58.000Z',
      user: 'Jade Sandoval',
      trail: { id: '10305376', name: 'North Mountain National Trail' },
    });
  });

  it('compact=true projects the feed directory when no feed is selected', async () => {
    const { handlers } = setup({
      feeds: [
        { name: 'local', displayName: 'Local', links: [{ rel: 'start', href: '/x' }] },
        { name: 'personal', displayName: 'My posts', links: [] },
      ],
      initialFeedHint: 'local',
    });
    const result = await handlers.get('alltrails_get_activity_feed')!({ userId: '12', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual({
      feeds: [
        { name: 'local', displayName: 'Local' },
        { name: 'personal', displayName: 'My posts' },
      ],
      initialFeedHint: 'local',
    });
  });

  it('compact=true tolerates a page with no pageInfo and a directory with bare feeds', async () => {
    const { handlers } = setup({ sections: [] });
    const page = await handlers.get('alltrails_get_activity_feed')!({ userId: '12', feed: 'personal', compact: true });
    expect(JSON.parse(page.content[0].text)).toEqual({ count: 0, items: [] });
  });

  it('compact=true tolerates directory entries with missing fields', async () => {
    const { handlers } = setup({ feeds: [{}] });
    const result = await handlers.get('alltrails_get_activity_feed')!({ userId: '12', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual({ feeds: [{}] });
  });

  it('compact=true falls back to raw when the feed page shape drifted', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drifted = { sections: 'nope' };
    const { handlers } = setup(drifted);
    const result = await handlers.get('alltrails_get_activity_feed')!({ userId: '12', feed: 'local', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual(drifted);
    expect(errSpy).toHaveBeenCalled();
  });

  it('compact=true falls back to raw when the directory shape drifted', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drifted = { feeds: 'nope' };
    const { handlers } = setup(drifted);
    const result = await handlers.get('alltrails_get_activity_feed')!({ userId: '12', compact: true });
    expect(JSON.parse(result.content[0].text)).toEqual(drifted);
    expect(errSpy).toHaveBeenCalled();
  });
});
