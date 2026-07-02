import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AllTrailsClient } from '../client.js';
import {
  jsonResponse,
  PhotoListSchema,
  ReviewListSchema,
  summarizePhoto,
  summarizeReview,
  TrailDetailSchema,
  summarizeTrailDetail,
} from './_shared.js';
import { parseAllTrails } from '../validate.js';

// Trail-scoped read tools: detail, reviews, photos, weather. All read-only.
export function registerTrailTools(server: McpServer, client: AllTrailsClient): void {
  server.registerTool('alltrails_get_trail', {
    description:
      'Get details for a single AllTrails trail by its numeric trail id. Returns name, location, ' +
      'length, elevation gain, difficulty, rating, route type, and (at higher detail levels) route geometry. ' +
      'Set compact=true for a slim projection (name, overview, length in m+mi, elevation gain, difficulty, ' +
      'rating, route type, location) — recommended unless you need the full record or geometry.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      trailId: z.string().describe('Numeric AllTrails trail id (e.g. "10236086")'),
      detail: z
        .enum(['basic', 'medium', 'offline'])
        .describe('Detail level. "medium" (default) is a good overview; "offline" includes full route geometry.')
        .optional(),
      compact: z.boolean().describe('Return a slim projection instead of the full record (default false)').optional(),
    },
  }, async (args) => {
    const detail = args.detail ?? 'medium';
    const raw = await client.request(
      'GET',
      `/api/alltrails/v3/trails/${encodeURIComponent(args.trailId)}?detail=${detail}`,
    );
    if (args.compact) {
      const parsed = parseAllTrails(TrailDetailSchema, raw, 'GET /api/alltrails/v3/trails/{id}');
      if (Array.isArray(parsed.trails)) {
        const trails = parsed.trails.map(summarizeTrailDetail);
        // The envelope is a one-element array in practice; unwrap it so the
        // common case reads as a single object.
        return jsonResponse(trails.length === 1 ? trails[0] : trails);
      }
    }
    return jsonResponse(raw);
  });

  server.registerTool('alltrails_get_trail_reviews', {
    description:
      'Get user reviews for an AllTrails trail by its numeric trail id. Set compact=true to return just ' +
      '{ user, rating, comment } per review.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      trailId: z.string().describe('Numeric AllTrails trail id'),
      limit: z.number().int().positive().describe('Max reviews to return (default 20)').optional(),
      compact: z.boolean().describe('Return a slim { user, rating, comment } per review (default false)').optional(),
    },
  }, async (args) => {
    const raw = await client.request(
      'POST',
      `/api/alltrails/v2/trails/${encodeURIComponent(args.trailId)}/reviews/search`,
      { limit: args.limit ?? 20 },
    );
    const parsed = parseAllTrails(ReviewListSchema, raw, 'POST /api/alltrails/v2/trails/{id}/reviews/search');
    if (args.compact && Array.isArray(parsed.trail_reviews)) {
      const reviews = parsed.trail_reviews.map(summarizeReview);
      return jsonResponse({ count: reviews.length, reviews });
    }
    return jsonResponse(raw);
  });

  server.registerTool('alltrails_get_trail_photos', {
    description:
      'Get photos for an AllTrails trail by its numeric trail id. Set compact=true to return just ' +
      '{ id, title, likeCount, user, uploadedAt, url } per photo — the url serves the actual image.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      trailId: z.string().describe('Numeric AllTrails trail id'),
      compact: z.boolean().describe('Return a slim projection per photo (default false)').optional(),
    },
  }, async (args) => {
    const raw = await client.request('GET', `/api/alltrails/v2/trails/${encodeURIComponent(args.trailId)}/photos`);
    if (args.compact) {
      const parsed = parseAllTrails(PhotoListSchema, raw, 'GET /api/alltrails/v2/trails/{id}/photos');
      if (Array.isArray(parsed.photos)) {
        const photos = parsed.photos.map(summarizePhoto);
        return jsonResponse({ count: photos.length, photos });
      }
    }
    return jsonResponse(raw);
  });

  server.registerTool('alltrails_get_trail_weather', {
    description: 'Get the weather overview for an AllTrails trail by its numeric trail id.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      trailId: z.string().describe('Numeric AllTrails trail id'),
    },
  }, async (args) => {
    const data = await client.request(
      'GET',
      `/api/alltrails/weather-service/v2/trails/${encodeURIComponent(args.trailId)}/overview`,
    );
    return jsonResponse(data);
  });
}
