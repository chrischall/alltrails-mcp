import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AllTrailsClient } from '../client.js';
import { parseAllTrails } from '../validate.js';
import {
  FeedDirectorySchema,
  FeedPageSchema,
  jsonResponse,
  ListItemsSchema,
  resolveUserId,
  summarizeFeedItem,
  summarizeListItem,
} from './_shared.js';

// Per-user read tools. These require a signed-in session (the captured browser
// cookie), and resolve the target user id from the argument, ALLTRAILS_USER_ID,
// or `GET /api/alltrails/me`.
export function registerUserTools(server: McpServer, client: AllTrailsClient): void {
  server.registerTool('alltrails_get_profile', {
    description: 'Get the signed-in AllTrails user profile (via /api/alltrails/me). Requires a signed-in session.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const data = await client.request('GET', '/api/alltrails/me');
    return jsonResponse(data);
  });

  server.registerTool('alltrails_list_user_lists', {
    description:
      'List an AllTrails user\'s saved lists (favorites, custom lists). Defaults to the signed-in user; ' +
      'pass a userId to target a specific public profile.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      userId: z.string().describe('Numeric AllTrails user id. Defaults to the signed-in user.').optional(),
    },
  }, async (args) => {
    const userId = await resolveUserId(client, args.userId);
    const data = await client.request('GET', `/api/alltrails/users/${encodeURIComponent(userId)}/lists`);
    return jsonResponse(data);
  });

  server.registerTool('alltrails_get_list_items', {
    description:
      'Get the trails saved in an AllTrails list by its numeric list id (from alltrails_list_user_lists, ' +
      'or a public "list" record from alltrails_search). Items are sparse references: each carries a ' +
      'trailId (hydrate with alltrails_get_trail), the curator\'s order, and any notes — not trail ' +
      'details. Set compact=true for slim { trailId, type, order, notes, addedAt } entries sorted by order.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      listId: z.string().describe('Numeric AllTrails list id'),
      compact: z.boolean().describe('Return slim per-item entries sorted by order (default false)').optional(),
    },
  }, async (args) => {
    const raw = await client.request('GET', `/api/alltrails/lists/${encodeURIComponent(args.listId)}/items`);
    if (args.compact) {
      const parsed = parseAllTrails(ListItemsSchema, raw, 'GET /api/alltrails/lists/{id}/items');
      if (Array.isArray(parsed.listItems)) {
        const items = parsed.listItems
          .map(summarizeListItem)
          .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
        return jsonResponse({ count: items.length, items });
      }
    }
    return jsonResponse(raw);
  });

  server.registerTool('alltrails_list_completed_trails', {
    description:
      'List the trails an AllTrails user has marked completed. Defaults to the signed-in user; pass a userId ' +
      'to target a specific public profile.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      userId: z.string().describe('Numeric AllTrails user id. Defaults to the signed-in user.').optional(),
    },
  }, async (args) => {
    const userId = await resolveUserId(client, args.userId);
    const data = await client.request('GET', `/api/alltrails/users/${encodeURIComponent(userId)}/trails/completed`);
    return jsonResponse(data);
  });

  server.registerTool('alltrails_get_activity_feed', {
    description:
      'Get an AllTrails user\'s activity feed (recorded hikes and posts). Defaults to the signed-in user; ' +
      'pass a userId to target a specific public profile. Without a feed argument this returns the feed ' +
      'DIRECTORY (the available feeds: local, timeline (following), personal (own posts)) — pass feed to ' +
      'get the actual items. Set compact=true for slim projections.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      userId: z.string().describe('Numeric AllTrails user id. Defaults to the signed-in user.').optional(),
      feed: z
        .enum(['local', 'timeline', 'personal'])
        .describe('Which feed to read: local (nearby activity), timeline (people you follow), personal (own posts). Omit to list the available feeds.')
        .optional(),
      maxItems: z.number().int().positive().describe('Max items per page (server-side)').optional(),
      cursor: z.string().describe('Opaque nextCursor from a previous page, for pagination').optional(),
      compact: z.boolean().describe('Return slim projections instead of the full records (default false)').optional(),
    },
  }, async (args) => {
    const userId = await resolveUserId(client, args.userId);
    const base = `/api/alltrails/community/blazes/v0/users/${encodeURIComponent(userId)}/feeds`;
    if (!args.feed) {
      const raw = await client.request('GET', base);
      if (args.compact) {
        const parsed = parseAllTrails(FeedDirectorySchema, raw, 'GET .../feeds');
        if (Array.isArray(parsed.feeds)) {
          return jsonResponse({
            feeds: parsed.feeds.map((f) => ({ name: f.name ?? undefined, displayName: f.displayName ?? undefined })),
            initialFeedHint: parsed.initialFeedHint ?? undefined,
          });
        }
      }
      return jsonResponse(raw);
    }
    const params = new URLSearchParams();
    if (args.maxItems !== undefined) params.set('maxItems', String(args.maxItems));
    if (args.cursor !== undefined) params.set('cursor', args.cursor);
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    const raw = await client.request('GET', `${base}/${args.feed}${qs}`);
    if (args.compact) {
      const parsed = parseAllTrails(FeedPageSchema, raw, 'GET .../feeds/{feed}');
      if (Array.isArray(parsed.sections)) {
        const items = parsed.sections
          .filter((s) => s.itemData !== undefined && s.itemData !== null)
          .map((s) => summarizeFeedItem(s.itemData!));
        return jsonResponse({
          count: items.length,
          hasNextPage: parsed.pageInfo?.hasNextPage ?? undefined,
          nextCursor: parsed.pageInfo?.nextCursor ?? undefined,
          items,
        });
      }
    }
    return jsonResponse(raw);
  });
}
