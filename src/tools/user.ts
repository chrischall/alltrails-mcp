import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AllTrailsClient } from '../client.js';
import { jsonResponse, resolveUserId } from './_shared.js';

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
      'pass a userId to target a specific public profile.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      userId: z.string().describe('Numeric AllTrails user id. Defaults to the signed-in user.').optional(),
    },
  }, async (args) => {
    const userId = await resolveUserId(client, args.userId);
    const data = await client.request(
      'GET',
      `/api/alltrails/community/blazes/v0/users/${encodeURIComponent(userId)}/feeds`,
    );
    return jsonResponse(data);
  });
}
