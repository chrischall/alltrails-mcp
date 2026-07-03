import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBridgeHealthcheckTool } from '@chrischall/mcp-utils/fetchproxy';
import type { AllTrailsClient } from '../client.js';

/**
 * A small, real API GET the probe round-trips. Deliberately a trail-detail
 * path (not /robots.txt): it exercises the exact protocol headers + JSON
 * guards every real tool uses, so a passing probe means real tools work.
 * Trail 10236086 = Mount Healy Overlook, the id used in tool descriptions.
 */
export const HEALTHCHECK_PROBE_PATH = '/api/alltrails/v3/trails/10236086?detail=basic';

/**
 * Register `alltrails_healthcheck` — round-trips the probe path through the
 * fetchproxy bridge and reports role/port/timing plus an actionable hint
 * ladder (bridge never came up vs extension not connected vs AllTrails-side
 * problem). The transport is reached lazily through `client.bridge()` so
 * registration never constructs it at server startup.
 */
export function registerHealthcheckTools(server: McpServer, client: AllTrailsClient): void {
  registerBridgeHealthcheckTool({
    server,
    prefix: 'alltrails',
    probePath: HEALTHCHECK_PROBE_PATH,
    hostLabel: 'www.alltrails.com',
    transport: {
      // runProbe must go through the STARTED transport (start() loads the
      // identity and must precede any verb), hence the async delegate.
      runProbe: async (fetchFn, probePath) => (await client.bridgeReady()).runProbe(fetchFn, probePath),
      status: () => client.bridge().status(),
    },
    probeFn: (path) => client.request<unknown>('GET', path).then((r) => JSON.stringify(r)),
  });
}
