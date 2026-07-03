import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchproxyBridgeDownError, type FetchproxyTransport } from '@chrischall/mcp-utils/fetchproxy';
import { AllTrailsClient } from '../src/client.js';

const CAPTURED_KEY = 'live-captured-key';

// ── Bridge stubs ────────────────────────────────────────────────────────────
// Every request runs through FetchproxyTransport.fetch; each entry maps to one
// bridge round-trip in order. The x-at-key app key is captured live via
// server.captureRequestHeader — `captures` maps to one capture each.
interface BridgeResponse {
  status: number;
  body?: string;
}

function stubTransport(responses: (BridgeResponse | Error)[], captures: (string | Error)[] = [CAPTURED_KEY]) {
  let idx = 0;
  let capIdx = 0;
  const start = vi.fn(async () => {});
  const fetch = vi.fn(async () => {
    const r = responses[idx++] ?? { status: 200, body: '{}' };
    if (r instanceof Error) throw r;
    return { status: r.status, body: r.body ?? '{}', url: 'https://www.alltrails.com/x' };
  });
  const captureRequestHeader = vi.fn(async () => {
    const c = captures[Math.min(capIdx++, captures.length - 1)];
    if (c instanceof Error) throw c;
    return c;
  });
  const transport = { start, fetch, server: { captureRequestHeader } } as unknown as FetchproxyTransport;
  return { transport, fetch, start, captureRequestHeader };
}

afterEach(() => {
  delete process.env.ALLTRAILS_DEBUG_LOG;
  vi.restoreAllMocks();
});

describe('AllTrailsClient — x-at-key live capture', () => {
  it('captures the key from the tab before the first request and sends it', async () => {
    const { transport, fetch, captureRequestHeader } = stubTransport([{ status: 200, body: '{"ok":true}' }]);
    const client = new AllTrailsClient({ transport });
    await client.request('GET', '/api/alltrails/v3/trails/1');

    expect(captureRequestHeader).toHaveBeenCalledWith({
      host: 'www.alltrails.com',
      path: '/api/alltrails/*',
      headerName: 'x-at-key',
    });
    const init = fetch.mock.calls[0][0] as { headers: Record<string, string> };
    expect(init.headers['x-at-key']).toBe(CAPTURED_KEY);
    // Capture precedes the request.
    expect(captureRequestHeader.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
  });

  it('captures once and reuses the in-memory key across requests', async () => {
    const { transport, captureRequestHeader } = stubTransport([
      { status: 200, body: '{}' },
      { status: 200, body: '{}' },
    ]);
    const client = new AllTrailsClient({ transport });
    await client.request('GET', '/api/alltrails/a');
    await client.request('GET', '/api/alltrails/b');
    expect(captureRequestHeader).toHaveBeenCalledTimes(1);
    expect(client.currentApiKey()).toBe(CAPTURED_KEY);
  });

  it('single-flights concurrent first requests onto one capture', async () => {
    const { transport, captureRequestHeader } = stubTransport([
      { status: 200, body: '{}' },
      { status: 200, body: '{}' },
    ]);
    const client = new AllTrailsClient({ transport });
    await Promise.all([client.request('GET', '/api/alltrails/a'), client.request('GET', '/api/alltrails/b')]);
    expect(captureRequestHeader).toHaveBeenCalledTimes(1);
  });

  it('re-captures on 401 (rotation signature), discards the stale key, and replays once', async () => {
    const { transport, fetch, captureRequestHeader } = stubTransport(
      [{ status: 401 }, { status: 200, body: '{"ok":true}' }],
      // First capture: the original key. Re-capture sees the stale key once
      // (e.g. a concurrent in-flight request of ours), then the rotated one.
      ['stale-key', 'stale-key', 'rotated-key'],
    );
    const client = new AllTrailsClient({ transport });
    const result = await client.request<{ ok: boolean }>('GET', '/api/alltrails/x');
    expect(result).toEqual({ ok: true });
    expect(captureRequestHeader).toHaveBeenCalledTimes(3);
    const retryInit = fetch.mock.calls[1][0] as { headers: Record<string, string> };
    expect(retryInit.headers['x-at-key']).toBe('rotated-key');
  });

  it('surfaces the original 400 when re-capture keeps seeing the same key (genuinely bad request)', async () => {
    const { transport, fetch } = stubTransport(
      [{ status: 400 }],
      // Every capture returns the same key — the app still uses it, so the
      // 400 was our fault, not a rotation.
      [CAPTURED_KEY],
    );
    const client = new AllTrailsClient({ transport });
    await expect(client.request('POST', '/api/alltrails/x', { bad: true })).rejects.toThrow(
      /AllTrails API error: 400/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the original error when the rotation re-capture itself fails', async () => {
    const { transport } = stubTransport([{ status: 401 }], ['first-key', new Error('capture timed out')]);
    const client = new AllTrailsClient({ transport });
    await expect(client.request('GET', '/api/alltrails/x')).rejects.toThrow(/AllTrails API error: 401/);
  });

  it('wraps a capture failure with an actionable open-a-tab hint', async () => {
    const { transport } = stubTransport(
      [],
      [new Error('fetchproxy: https://www.alltrails.com/api/alltrails/* did not respond within 30000ms')],
    );
    const client = new AllTrailsClient({ transport });
    const err = await client.request('GET', '/api/alltrails/x').catch((e) => e as Error);
    expect(err.message).toContain('did not respond within 30000ms');
    expect(err.message).toContain('open or refresh a signed-in www.alltrails.com page');
  });

  it('currentApiKey() is undefined before the first capture', () => {
    const { transport } = stubTransport([]);
    expect(new AllTrailsClient({ transport }).currentApiKey()).toBeUndefined();
  });
});

describe('AllTrailsClient — bridge requests', () => {
  it('routes requests through the bridge with the protocol headers and no Cookie', async () => {
    const { transport, fetch } = stubTransport([{ status: 200, body: '{"ok":true}' }]);
    const client = new AllTrailsClient({ transport });
    const result = await client.request<{ ok: boolean }>('GET', '/api/alltrails/v3/trails/1');

    expect(result).toEqual({ ok: true });
    const init = fetch.mock.calls[0][0] as {
      method: string;
      path: string;
      headers: Record<string, string>;
      body?: string;
    };
    expect(init.method).toBe('GET');
    expect(init.path).toBe('/api/alltrails/v3/trails/1');
    expect(init.headers['x-at-key']).toBe(CAPTURED_KEY);
    expect(init.headers['x-at-caller']).toBe('Mugen');
    expect(init.headers['x-language-locale']).toBe('en-US');
    expect(init.headers['Accept']).toBe('application/json');
    // The browser owns Cookie / User-Agent / Origin — never set by the client.
    expect(init.headers['Cookie']).toBeUndefined();
    expect(init.headers['User-Agent']).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('serializes a JSON body + Content-Type on POST', async () => {
    const { transport, fetch } = stubTransport([{ status: 200 }]);
    const client = new AllTrailsClient({ transport });
    await client.request('POST', '/api/alltrails/v2/trails/1/reviews/search', { limit: 5 });
    const init = fetch.mock.calls[0][0] as { headers: Record<string, string>; body?: string };
    expect(init.body).toBe(JSON.stringify({ limit: 5 }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('parses an empty response body as null', async () => {
    const { transport } = stubTransport([{ status: 200, body: '' }]);
    const result = await new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x');
    expect(result).toBeNull();
  });

  it('throws an actionable error when a 2xx body is not JSON (DataDome interstitial)', async () => {
    const { transport } = stubTransport([
      { status: 200, body: '<html><body>Please verify you are human</body></html>' },
    ]);
    const err = await new AllTrailsClient({ transport })
      .request('GET', '/api/alltrails/x')
      .catch((e) => e as Error);
    expect(err.message).toContain('non-JSON for GET /api/alltrails/x');
    expect(err.message).toContain('DataDome');
    expect(err.message).toContain('<html><body>Please verify');
  });

  it('throws with a signed-in-tab hint on a persistent 403', async () => {
    const { transport } = stubTransport([{ status: 403 }]);
    const err = await new AllTrailsClient({ transport })
      .request('GET', '/api/alltrails/x')
      .catch((e) => e as Error);
    expect(err.message).toContain('AllTrails API error: 403');
    expect(err.message).toContain('signed into alltrails.com');
  });

  it('throws a generic error (no sign-in hint) on a 500', async () => {
    const { transport } = stubTransport([{ status: 500 }]);
    const err = await new AllTrailsClient({ transport })
      .request('GET', '/api/alltrails/x')
      .catch((e) => e as Error);
    expect(err.message).toContain('AllTrails API error: 500');
    expect(err.message).not.toContain('signed into');
  });

  it('waits 2s and replays once on 429', async () => {
    vi.useFakeTimers();
    try {
      const { transport, fetch } = stubTransport([{ status: 429 }, { status: 200, body: '{"ok":true}' }]);
      const promise = new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x');
      await vi.advanceTimersByTimeAsync(2000);
      expect(await promise).toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws "Rate limited" on a second 429', async () => {
    vi.useFakeTimers();
    try {
      const { transport } = stubTransport([{ status: 429 }, { status: 429 }]);
      const promise = new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x');
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(2000);
      await expect(promise).rejects.toThrow('Rate limited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('surfaces the bridge-down hint when the extension is unreachable', async () => {
    const down = new FetchproxyBridgeDownError({
      originalError: 'content_script_unreachable',
      op: 'fetch',
      role: 'host',
      port: 37_149,
    });
    const { transport } = stubTransport([down]);
    const err = await new AllTrailsClient({ transport })
      .request('GET', '/api/alltrails/x')
      .catch((e) => e as Error);
    expect(err.message).toContain('AllTrails bridge');
    // The typed error's remediation hint must survive verbatim.
    expect(err.message).toContain(down.hint);
  });

  it('wraps an untyped bridge error without a hint', async () => {
    const { transport } = stubTransport([new Error('weird wire failure')]);
    await expect(new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x')).rejects.toThrow(
      /AllTrails bridge.*weird wire failure/,
    );
  });

  it('starts the transport exactly once before the first verb (listen() must precede fetch)', async () => {
    const { transport, fetch, start } = stubTransport([
      { status: 200, body: '{}' },
      { status: 200, body: '{}' },
    ]);
    const client = new AllTrailsClient({ transport });
    await client.request('GET', '/api/alltrails/a');
    await client.request('GET', '/api/alltrails/b');
    expect(start).toHaveBeenCalledTimes(1);
    expect(start.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
  });

  it('retries start() on the next request after a failed start', async () => {
    const start = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('identity dir unwritable'))
      .mockResolvedValue(undefined);
    const fetch = vi.fn(async () => ({ status: 200, body: '{"ok":1}', url: 'u' }));
    const captureRequestHeader = vi.fn(async () => CAPTURED_KEY);
    const transport = { start, fetch, server: { captureRequestHeader } } as unknown as FetchproxyTransport;
    const client = new AllTrailsClient({ transport });
    await expect(client.request('GET', '/api/alltrails/x')).rejects.toThrow(/identity dir unwritable/);
    expect(await client.request('GET', '/api/alltrails/x')).toEqual({ ok: 1 });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('creates the real transport lazily exactly once', async () => {
    const client = new AllTrailsClient();
    const first = client.bridge();
    expect(client.bridge()).toBe(first);
    expect(typeof first.fetch).toBe('function');
  });
});

describe('ALLTRAILS_DEBUG_LOG', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    process.env.ALLTRAILS_DEBUG_LOG = '1';
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('logs requests and responses', async () => {
    const { transport } = stubTransport([{ status: 200, body: '{"ok":true}' }]);
    await new AllTrailsClient({ transport }).request('POST', '/api/alltrails/v2/trails/1/reviews/search', {
      limit: 3,
    });
    const dbg = errSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[alltrails-debug]'));
    expect(dbg.some((l) => l.includes('→ POST') && l.includes('via bridge'))).toBe(true);
    expect(dbg.some((l) => l.includes('"limit":3'))).toBe(true);
    expect(dbg.some((l) => l.includes('← 200'))).toBe(true);
    expect(dbg.some((l) => l.includes('response body:'))).toBe(true);
  });

  it('logs <none> for a bodyless request', async () => {
    const { transport } = stubTransport([{ status: 200 }]);
    await new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x');
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('body: <none>'))).toBe(true);
  });

  it('marks a replayed request with (retry)', async () => {
    vi.useFakeTimers();
    try {
      const { transport } = stubTransport([{ status: 429 }, { status: 200 }]);
      const promise = new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x');
      await vi.advanceTimersByTimeAsync(2000);
      await promise;
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('(retry)'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs <empty> when the response body is genuinely empty', async () => {
    const { transport } = stubTransport([{ status: 200, body: '' }]);
    await new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x');
    expect(errSpy.mock.calls.some((c) => String(c[0]) === '[alltrails-debug] response body: <empty>')).toBe(true);
  });
});
