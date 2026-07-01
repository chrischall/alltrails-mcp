import { rawTextResult, textResult } from '@chrischall/mcp-utils';
import { z } from 'zod';
import type { AllTrailsClient } from '../client.js';
import { getConfiguredUserId } from '../config.js';
import { parseAllTrails } from '../validate.js';

// Pretty-printed JSON tool result. Thin wrapper over @chrischall/mcp-utils'
// `textResult` so the rest of the codebase keeps the local name.
export const jsonResponse = textResult;

// Raw-string tool result. Wrapper over @chrischall/mcp-utils' `rawTextResult`.
export const textResponse = rawTextResult;

// `GET /api/alltrails/me` returns the signed-in user; we only read the id.
// Loose: every other field passes through untouched.
const MeSchema = z.looseObject({
  user: z.looseObject({ id: z.union([z.number(), z.string()]).optional() }).optional(),
  id: z.union([z.number(), z.string()]).optional(),
});

/**
 * Resolve the AllTrails user id for the per-user endpoints. Priority:
 *   1. an explicit `userId` argument passed to the tool,
 *   2. the ALLTRAILS_USER_ID env var,
 *   3. a `GET /api/alltrails/me` lookup of the signed-in user.
 *
 * Throws an actionable error if none of those yields an id (e.g. the session
 * isn't actually signed in — `/me` is anonymous).
 */
export async function resolveUserId(client: AllTrailsClient, provided?: string): Promise<string> {
  const explicit = provided?.trim() || getConfiguredUserId();
  if (explicit) return explicit;
  const me = parseAllTrails(MeSchema, await client.request('GET', '/api/alltrails/me'), 'GET /api/alltrails/me');
  const id = me?.user?.id ?? me?.id;
  if (id === undefined || id === null || `${id}`.length === 0) {
    throw new Error(
      'Could not determine your AllTrails user id from /api/alltrails/me — you may not be signed in. ' +
        'Pass a userId explicitly, set ALLTRAILS_USER_ID, or capture a signed-in browser session.',
    );
  }
  return `${id}`;
}
