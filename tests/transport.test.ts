import { describe, it, expect, vi, afterEach } from 'vitest';
import type { FetchproxyServer, FetchproxyServerOpts } from '@chrischall/mcp-utils/fetchproxy';
import { createAllTrailsTransport } from '../src/transport.js';
import pkg from '../package.json' with { type: 'json' };

// The createServer test seam lets us capture the FetchproxyServerOpts the
// factory forwards WITHOUT vi.mock('@fetchproxy/server') — the seam is the
// documented way to unit-test a transport built on createFetchproxyTransport.
function capturingSeam() {
  const captured: { opts?: FetchproxyServerOpts } = {};
  const createServer = (opts: FetchproxyServerOpts): FetchproxyServer => {
    captured.opts = opts;
    return {
      loadIdentity: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      bridgeHealth: vi.fn(() => ({})),
      role: null,
    } as unknown as FetchproxyServer;
  };
  return { captured, createServer };
}

describe('createAllTrailsTransport', () => {
  afterEach(() => {
    delete process.env.ALLTRAILS_WS_PORT;
    delete process.env.ALLTRAILS_REQUEST_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  it('binds the fleet-shared concentrator port 37149 by default', () => {
    const { captured, createServer } = capturingSeam();
    createAllTrailsTransport(createServer);
    expect(captured.opts?.port).toBe(37_149);
  });

  it('honors ALLTRAILS_WS_PORT', () => {
    process.env.ALLTRAILS_WS_PORT = '40123';
    const { captured, createServer } = capturingSeam();
    createAllTrailsTransport(createServer);
    expect(captured.opts?.port).toBe(40_123);
  });

  it('declares alltrails.com with the www default subdomain and the package identity', () => {
    const { captured, createServer } = capturingSeam();
    createAllTrailsTransport(createServer);
    expect(captured.opts?.domains).toEqual(['alltrails.com']);
    expect(captured.opts?.serverName).toBe(pkg.name);
    expect(captured.opts?.version).toBe(pkg.version);
  });

  it('forwards the request timeout as the bridge fetchTimeoutMs', () => {
    process.env.ALLTRAILS_REQUEST_TIMEOUT_MS = '12345';
    const { captured, createServer } = capturingSeam();
    createAllTrailsTransport(createServer);
    expect((captured.opts as FetchproxyServerOpts & { fetchTimeoutMs?: number }).fetchTimeoutMs).toBe(12_345);
  });

  it('returns the shared transport surface (fetch/requestJson/runProbe/status)', () => {
    const { createServer } = capturingSeam();
    const transport = createAllTrailsTransport(createServer);
    expect(typeof transport.fetch).toBe('function');
    expect(typeof transport.requestJson).toBe('function');
    expect(typeof transport.runProbe).toBe('function');
    expect(typeof transport.status).toBe('function');
    expect(typeof transport.start).toBe('function');
    expect(typeof transport.close).toBe('function');
  });
});
