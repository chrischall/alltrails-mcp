#!/usr/bin/env node
import { runMcp } from '@chrischall/mcp-utils';
import { client } from './client.js';
import { registerTrailTools } from './tools/trails.js';
import { registerExploreTools } from './tools/explore.js';
import { registerUserTools } from './tools/user.js';

// runMcp builds the McpServer, applies the registrars (with `client` threaded
// through as deps), prints the banner to stderr, wires SIGINT/SIGTERM graceful
// shutdown, and connects the stdio transport. The deferred-config-error pattern
// is preserved: `client` is constructed at module load in ./client.js (auth is
// resolved lazily on the first tool call), so the host's initial tools/list
// always succeeds before any credential check runs.
await runMcp({
  name: 'alltrails',
  version: '0.2.0', // x-release-please-version
  deps: client,
  tools: [registerTrailTools, registerExploreTools, registerUserTools],
  banner:
    '[alltrails-mcp] Unofficial AllTrails MCP. AllTrails has no public API; this reverse-engineers ' +
    'the internal one and may break or violate their ToS. Developed and maintained by AI (Claude). Use at your own discretion.',
});
