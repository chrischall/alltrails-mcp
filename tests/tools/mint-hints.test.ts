import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { AllTrailsClient } from '../../src/client.js';
import { registerTrailTools } from '../../src/tools/trails.js';
import { registerExploreTools } from '../../src/tools/explore.js';
import { registerUserTools } from '../../src/tools/user.js';
import { registerHealthcheckTools } from '../../src/tools/healthcheck.js';
import { briefFeedLine } from '../../src/tools/_shared.js';

/**
 * Context-group hints (`_meta.mint`, the mcp-host context-groups contract),
 * read off `tools/list` — what a host actually sees.
 */
type Listed = {
  name: string;
  annotations?: Record<string, unknown>;
  inputSchema: { properties?: Record<string, { enum?: unknown[] }> };
  _meta?: { mint?: Record<string, unknown> };
};

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const CANONICAL_INTENTS = ['whats-new', 'whats-due', 'whats-on'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  alltrails_search: 'lookup',
  alltrails_resolve_location: 'lookup',
  alltrails_get_trail: 'lookup',
  alltrails_get_trail_reviews: 'lookup',
  alltrails_get_trail_photos: 'lookup',
  alltrails_get_trail_gpx: 'lookup',
  alltrails_get_trail_weather: 'lookup',
  alltrails_get_profile: 'lookup',
  alltrails_list_user_lists: 'lookup',
  alltrails_get_list_items: 'lookup',
  alltrails_list_completed_trails: 'lookup',
  alltrails_get_activity_feed: 'whats-new',
};

function makeClient(): AllTrailsClient {
  return new AllTrailsClient();
}

async function served(client: AllTrailsClient = makeClient()) {
  const h = await createTestHarness((server) => {
    registerTrailTools(server, client);
    registerExploreTools(server, client);
    registerUserTools(server, client);
    registerHealthcheckTools(server, client);
  });
  return h;
}

async function listed(): Promise<Listed[]> {
  const h = await served();
  const { tools } = await h.client.listTools();
  await h.close();
  return tools as Listed[];
}

afterEach(() => vi.restoreAllMocks());

describe('_meta.mint on tools/list', () => {
  it('names every served tool, so a new tool cannot skip the decision', async () => {
    const names = (await listed()).map((t) => t.name).filter((n) => n !== 'alltrails_healthcheck');
    expect(names.sort()).toEqual(Object.keys(EXPECTED_INTENT).sort());
  });

  it('leaves only the mcp-utils healthcheck unhinted', async () => {
    const unhinted = (await listed()).filter((t) => !t._meta?.mint).map((t) => t.name);
    expect(unhinted).toEqual(['alltrails_healthcheck']);
  });

  it.each(Object.entries(EXPECTED_INTENT))('%s declares domain travel and intent %s', async (name, intent) => {
    const tool = (await listed()).find((t) => t.name === name);
    expect(tool?._meta?.mint?.domain).toBe('travel');
    expect(tool?._meta?.mint?.intent).toBe(intent);
  });

  it('every hint is shaped per the host contract', async () => {
    for (const t of await listed()) {
      if (t.name === 'alltrails_healthcheck') continue;
      const m = t._meta!.mint!;
      expect(Object.keys(m).filter((k) => !KEYS.includes(k)), t.name).toEqual([]);
      expect(DOMAINS, t.name).toContain(m.domain);
      expect(INTENTS, t.name).toContain(m.intent);
      const props = t.inputSchema.properties ?? {};
      if ('canonical' in m) {
        expect(m.canonical, t.name).toBe(true);
        expect(t.annotations?.readOnlyHint, t.name).toBe(true);
        expect(CANONICAL_INTENTS, t.name).toContain(m.intent);
      }
      if ('subject' in m) expect(props, t.name).toHaveProperty(m.subject as string);
      if ('when' in m) {
        const when = m.when as Record<string, string>;
        expect(Object.keys(when).sort(), t.name).toEqual(['end', 'start']);
        expect(props, t.name).toHaveProperty(when.start);
        expect(props, t.name).toHaveProperty(when.end);
      }
      if ('aliases' in m) {
        const aliases = m.aliases as string[];
        expect(aliases.length, t.name).toBeLessThanOrEqual(8);
        for (const a of aliases) {
          expect(a.length, t.name).toBeLessThanOrEqual(40);
          expect(a, t.name).toBe(a.toLowerCase());
          // Words a person says, never a tool name.
          expect(a, t.name).not.toMatch(/alltrails_/);
        }
      }
    }
  });

  it('marks at most one canonical read per intent: the activity feed for whats-new', async () => {
    const canonical = (await listed())
      .filter((t) => t._meta?.mint?.canonical === true)
      .map((t) => [t.name, t._meta!.mint!.intent]);
    expect(canonical).toEqual([['alltrails_get_activity_feed', 'whats-new']]);
  });

  it('the canonical feed names no subject (there is no listable set) and takes no range', async () => {
    const feed = (await listed()).find((t) => t.name === 'alltrails_get_activity_feed')!;
    expect(feed._meta!.mint).not.toHaveProperty('subject');
    expect(feed._meta!.mint).not.toHaveProperty('when');
    expect(feed.inputSchema.properties?.view?.enum).toEqual(['compact', 'full', 'brief']);
  });
});

describe('alltrails_get_activity_feed view:"brief"', () => {
  const page = {
    sections: [
      {
        section_type: 'feed-item',
        itemData: {
          itemType: 'activity:created',
          timestamp: '2026-06-25T13:38:58.000Z',
          description: '<p>Hiked <a href="/trail/x">Example Ridge Loop</a></p>',
          user: { firstName: 'Sam', lastName: 'Example' },
          trail: { id: 1, name: 'Example Ridge Loop' },
        },
      },
      {
        section_type: 'feed-item',
        itemData: {
          itemType: 'review:created',
          timestamp: null,
          user: { firstName: 'Alex', lastName: 'Sample' },
          trail: { id: 2, name: `A ${'very '.repeat(40)}long trail name` },
        },
      },
      { section_type: 'feed-item', itemData: { itemType: null } },
      { section_type: 'banner' },
    ],
    pageInfo: { hasNextPage: true, nextCursor: 'c2' },
  };

  async function callBrief(args: Record<string, unknown>) {
    const client = makeClient();
    const request = vi.spyOn(client, 'request').mockImplementation(async (_m: string, path: string) =>
      path === '/api/alltrails/me' ? { users: [{ id: 12 }] } : page,
    );
    const h = await served(client);
    const result = await h.client.callTool({ name: 'alltrails_get_activity_feed', arguments: args });
    await h.close();
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    return { request, text };
  }

  it('answers one line per item, ≤ 120 chars, shaped "title — <ISO date | no date> — <status>"', async () => {
    const { text } = await callBrief({ userId: '12', feed: 'timeline', view: 'brief' });
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(120);
      expect(line).toMatch(/^.+ — (\d{4}-\d{2}-\d{2}\S*|no date) — \S.*$/);
    }
    expect(lines[0]).toBe('Sam Example: Hiked Example Ridge Loop — 2026-06-25T13:38:58.000Z — recorded');
    expect(lines[1]).toMatch(/^Alex Sample: A very .*… — no date — reviewed$/);
    expect(lines[2]).toBe('(untitled) — no date — posted');
  });

  it('reads the timeline (people you follow) when no feed is named, never the directory', async () => {
    const { request } = await callBrief({ userId: '12', view: 'brief' });
    expect(request).toHaveBeenCalledWith('GET', '/api/alltrails/community/blazes/v0/users/12/feeds/timeline');
  });

  it('keeps view out of the request', async () => {
    const { request } = await callBrief({ view: 'brief' });
    for (const call of request.mock.calls) expect(JSON.stringify(call)).not.toContain('brief');
  });

  it('shows an unknown item type as AllTrails names it', () => {
    expect(briefFeedLine({ itemType: 'badge:earned', trail: { name: 'Example Loop' } })).toBe(
      'Example Loop — no date — badge:earned',
    );
  });

  it.each([[{ sections: [] }], [null]])('says so in one line when the feed is empty (%j)', async (body) => {
    const client = makeClient();
    vi.spyOn(client, 'request').mockResolvedValue(body);
    const h = await served(client);
    const result = await h.client.callTool({
      name: 'alltrails_get_activity_feed',
      arguments: { userId: '12', view: 'brief' },
    });
    await h.close();
    expect((result.content as Array<{ text: string }>)[0].text).toBe('No new activity.');
  });
});
