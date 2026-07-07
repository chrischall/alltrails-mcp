// ────────────────────────────────────────────────────────────────────────────
// Fetchproxy bridge transport — the hot path for every AllTrails API request
// ────────────────────────────────────────────────────────────────────────────
//
// AllTrails fronts its internal API with DataDome, which fingerprints the HTTP
// client itself (TLS/JA3) — a cookie captured from the browser and replayed
// from Node gets 403'd even while the identical same-origin fetch inside the
// signed-in tab returns 200 (verified live 2026-07-02). So requests run
// through the fetchproxy bridge: each one is a same-origin fetch executed in
// the user's signed-in alltrails.com tab, and the bot wall never sees Node.
//
// This is the fleet's fetchproxy archetype (redfin/zillow): a thin factory
// over @chrischall/mcp-utils' createFetchproxyTransport, which owns the
// FetchproxyServer construction, the start/close/status lifecycle, and the
// fetch/requestJson/runProbe verb adapters. The ONE per-site decision here is
// `defaultSubdomain: 'www'` — every AllTrails API path targets
// www.alltrails.com.

import {
  createFetchproxyTransport,
  type FetchproxyServer,
  type FetchproxyServerOpts,
  type FetchproxyTransport,
} from '@chrischall/mcp-utils/fetchproxy';
import { getRequestTimeoutMs, getWsPort } from './config.js';
import pkg from '../package.json' with { type: 'json' };

export type { FetchproxyTransport } from '@chrischall/mcp-utils/fetchproxy';

/**
 * Build the AllTrails bridge transport. Construction is cheap — the port only
 * binds (and the extension only pairs) on the first verb call, so callers can
 * create this eagerly without touching the bridge.
 *
 * @param createServer Test seam forwarded to `createFetchproxyTransport`: a
 *   factory that builds the underlying `FetchproxyServer`. Tests pass a
 *   capturing mock; production omits it.
 */
export function createAllTrailsTransport(
  createServer?: (opts: FetchproxyServerOpts) => FetchproxyServer,
): FetchproxyTransport {
  return createFetchproxyTransport({
    // The whole fetchproxy fleet shares ONE concentrator port — the Transporter
    // extension dials it, and servers host/peer-elect on it. Never default to a
    // "unique" port; override only for test isolation.
    port: getWsPort(),
    serverName: pkg.name,
    version: pkg.version,
    // 'alltrails.com' matches www.alltrails.com (the extension treats each
    // domain as "exact host or any subdomain of it").
    domains: ['alltrails.com'],
    defaultSubdomain: 'www',
    // The x-at-key app key is never stored in code or config — the client
    // captures the live value from the tab's own API traffic on first need
    // (client.ts). That capture needs the capture_request_header capability
    // declared here, alongside the default fetch verb.
    capabilities: ['fetch', 'capture_request_header'],
    captureHeaders: [{ host: 'www.alltrails.com', path: '/api/alltrails/*', headerName: 'x-at-key' }],
    // Canonical fleet startup banner on start() — stderr only (stdout is the
    // JSON-RPC channel).
    logListening: true,
    // Reuse the existing debug switch for the bridge's per-request logging.
    debugEnvVar: 'ALLTRAILS_DEBUG_LOG',
    // One timeout knob: ALLTRAILS_REQUEST_TIMEOUT_MS drives the bridge's
    // per-request deadline.
    fetchTimeoutMs: getRequestTimeoutMs(),
    ...(createServer ? { createServer } : {}),
  });
}
