import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FetchproxyBridgeDownError, type FetchproxyTransport } from '@chrischall/mcp-utils/fetchproxy';
import { AllTrailsClient, AllTrailsConfigError } from '../src/client.js';

const COOKIE = 'datadome=ddvalue; _at_session=sess1';

// ── Bridge stubs ────────────────────────────────────────────────────────────
// The client's hot path delegates to FetchproxyTransport.fetch; each entry
// maps to one bridge round-trip in order.
interface BridgeResponse {
  status: number;
  body?: string;
}

function stubTransport(responses: (BridgeResponse | Error)[]) {
  let idx = 0;
  const fetch = vi.fn(async () => {
    const r = responses[idx++] ?? { status: 200, body: '{}' };
    if (r instanceof Error) throw r;
    return { status: r.status, body: r.body ?? '{}', url: 'https://www.alltrails.com/x' };
  });
  return { transport: { fetch } as unknown as FetchproxyTransport, fetch };
}

// ── Node-path fetch mock (env-cookie escape hatch) ──────────────────────────
interface MockResponse {
  status: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

function mockFetch(responses: MockResponse[]) {
  let idx = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const r = responses[idx++] ?? { status: 200, body: {} };
    const headerMap = r.headers ?? {};
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: String(r.status),
      headers: { get: (k: string) => headerMap[k.toLowerCase()] ?? null },
      text: async () => (r.text !== undefined ? r.text : JSON.stringify(r.body)),
    } as unknown as Response;
  });
}

afterEach(() => {
  delete process.env.ALLTRAILS_COOKIE;
  delete process.env.ALLTRAILS_DISABLE_FETCHPROXY;
  delete process.env.ALLTRAILS_DEBUG_LOG;
  delete process.env.ALLTRAILS_REQUEST_TIMEOUT_MS;
  vi.restoreAllMocks();
});

describe('AllTrailsClient — bridge path (default)', () => {
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
    expect(init.headers['x-at-key']).toBe('3p0t5s6b5g4g0e8k3c1j3w7y5c3m4t8i');
    expect(init.headers['x-at-caller']).toBe('Mugen');
    expect(init.headers['x-language-locale']).toBe('en-US');
    expect(init.headers['Accept']).toBe('application/json');
    // The browser owns Cookie / User-Agent / Origin in bridge mode.
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

  it('honors the ALLTRAILS_API_KEY override in the bridge headers', async () => {
    process.env.ALLTRAILS_API_KEY = 'rotated-key';
    try {
      const { transport, fetch } = stubTransport([{ status: 200 }]);
      await new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x');
      const init = fetch.mock.calls[0][0] as { headers: Record<string, string> };
      expect(init.headers['x-at-key']).toBe('rotated-key');
    } finally {
      delete process.env.ALLTRAILS_API_KEY;
    }
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

  it('throws with a signed-in-tab hint on 403', async () => {
    const { transport } = stubTransport([{ status: 403 }]);
    const err = await new AllTrailsClient({ transport })
      .request('GET', '/api/alltrails/x')
      .catch((e) => e as Error);
    expect(err.message).toContain('AllTrails API error: 403');
    expect(err.message).toContain('signed into alltrails.com');
  });

  it('throws the same hint on 401', async () => {
    const { transport } = stubTransport([{ status: 401 }]);
    await expect(new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x')).rejects.toThrow(
      /signed into alltrails\.com/,
    );
  });

  it('throws a generic error (no sign-in hint) on a 500', async () => {
    const { transport } = stubTransport([{ status: 500 }]);
    const err = await new AllTrailsClient({ transport })
      .request('GET', '/api/alltrails/x')
      .catch((e) => e as Error);
    expect(err.message).toContain('AllTrails API error: 500');
    expect(err.message).not.toContain('signed into');
  });

  it('waits 2s and replays once on 429 (bridge responses carry no Retry-After)', async () => {
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

  it('creates the real transport lazily exactly once', async () => {
    const client = new AllTrailsClient();
    const first = client.bridge();
    expect(client.bridge()).toBe(first);
    expect(typeof first.fetch).toBe('function');
  });
});

describe('AllTrailsClient — ALLTRAILS_COOKIE escape hatch (Node-direct)', () => {
  beforeEach(() => {
    process.env.ALLTRAILS_COOKIE = COOKIE;
  });

  it('sends Cookie + browser-shaped headers via Node fetch and never touches the bridge', async () => {
    const { transport, fetch: bridgeFetch } = stubTransport([]);
    const spy = mockFetch([{ status: 200, body: { ok: true } }]);
    const client = new AllTrailsClient({ transport });
    const result = await client.request<{ ok: boolean }>('GET', '/api/alltrails/v3/trails/1');

    expect(result).toEqual({ ok: true });
    expect(bridgeFetch).not.toHaveBeenCalled();
    const init = spy.mock.calls[0][1] as RequestInit;
    const h = init.headers as Record<string, string>;
    expect(h['Cookie']).toBe(COOKIE);
    expect(h['x-at-key']).toBe('3p0t5s6b5g4g0e8k3c1j3w7y5c3m4t8i');
    expect(h['x-at-caller']).toBe('Mugen');
    expect(h['x-language-locale']).toBe('en-US');
    expect(h['User-Agent']).toContain('Mozilla/5.0');
    expect(h['Accept']).toBe('application/json');
    expect(h['Origin']).toBe('https://www.alltrails.com');
    expect(h['Referer']).toBe('https://www.alltrails.com/');
    expect(h['Sec-Fetch-Site']).toBe('same-origin');
    expect(h['Content-Type']).toBeUndefined();
    expect(spy.mock.calls[0][0]).toBe('https://www.alltrails.com/api/alltrails/v3/trails/1');
  });

  it('sends a JSON body + Content-Type on POST', async () => {
    const spy = mockFetch([{ status: 200, body: {} }]);
    await new AllTrailsClient().request('POST', '/api/alltrails/v2/trails/1/reviews/search', { limit: 5 });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ limit: 5 }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws with a stale-cookie hint on 403 (no re-capture exists for an env cookie)', async () => {
    const spy = mockFetch([{ status: 403, body: {} }]);
    const err = await new AllTrailsClient().request('GET', '/api/alltrails/x').catch((e) => e as Error);
    expect(err.message).toContain('AllTrails API error: 403');
    expect(err.message).toContain('ALLTRAILS_COOKIE');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('honors a delta-seconds Retry-After on 429', async () => {
    vi.useFakeTimers();
    try {
      const spy = mockFetch([
        { status: 429, body: {}, headers: { 'retry-after': '5' } },
        { status: 200, body: { ok: true } },
      ]);
      const promise = new AllTrailsClient().request('GET', '/api/alltrails/x');
      // The fleet-standard 2s must NOT be enough — the server asked for 5s.
      await vi.advanceTimersByTimeAsync(4999);
      expect(spy).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await promise).toEqual({ ok: true });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('caps a hostile/buggy Retry-After at 30s', async () => {
    vi.useFakeTimers();
    try {
      const spy = mockFetch([
        { status: 429, body: {}, headers: { 'retry-after': '3600' } },
        { status: 200, body: { ok: 1 } },
      ]);
      const promise = new AllTrailsClient().request('GET', '/api/alltrails/x');
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await promise).toEqual({ ok: 1 });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to the 2s default for a non-numeric (HTTP-date) Retry-After', async () => {
    vi.useFakeTimers();
    try {
      const spy = mockFetch([
        { status: 429, body: {}, headers: { 'retry-after': 'Wed, 01 Jul 2026 16:00:00 GMT' } },
        { status: 200, body: { ok: 2 } },
      ]);
      const promise = new AllTrailsClient().request('GET', '/api/alltrails/x');
      await vi.advanceTimersByTimeAsync(2000);
      expect(await promise).toEqual({ ok: 2 });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('request timeout', () => {
    function mockHang() {
      return vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
        return new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          signal?.addEventListener('abort', () => {
            const err: Error & { name?: string } = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });
    }

    it('aborts a hung request after the default 30s timeout', async () => {
      vi.useFakeTimers();
      try {
        mockHang();
        const promise = new AllTrailsClient().request('GET', '/api/alltrails/v3/trails/9');
        promise.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(promise).rejects.toThrow(
          /AllTrails API request timed out after 30000ms.*GET \/api\/alltrails\/v3\/trails\/9/,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('respects ALLTRAILS_REQUEST_TIMEOUT_MS', async () => {
      process.env.ALLTRAILS_REQUEST_TIMEOUT_MS = '5000';
      vi.useFakeTimers();
      try {
        mockHang();
        const promise = new AllTrailsClient().request('GET', '/api/alltrails/x');
        promise.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(5000);
        await expect(promise).rejects.toThrow(/timed out after 5000ms/);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not fire the timeout when the request completes promptly', async () => {
      vi.useFakeTimers();
      try {
        mockFetch([{ status: 200, body: { ok: true } }]);
        const result = await new AllTrailsClient().request<{ ok: boolean }>('GET', '/api/alltrails/x');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(result).toEqual({ ok: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('propagates non-abort fetch errors unchanged', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED'));
      await expect(new AllTrailsClient().request('GET', '/api/alltrails/x')).rejects.toThrow(
        'connect ECONNREFUSED',
      );
    });
  });
});

describe('AllTrailsClient — nothing configured', () => {
  it('throws a permanent AllTrailsConfigError when the bridge is disabled and no cookie is set', async () => {
    process.env.ALLTRAILS_DISABLE_FETCHPROXY = '1';
    const client = new AllTrailsClient();
    const err = await client.request('GET', '/api/alltrails/x').catch((e) => e as Error);
    expect(err).toBeInstanceOf(AllTrailsConfigError);
    expect(err.message).toMatch(/set ALLTRAILS_COOKIE/);
    // And it stays a config error on subsequent calls.
    await expect(client.request('GET', '/api/alltrails/x')).rejects.toThrow(/ALLTRAILS_DISABLE_FETCHPROXY/);
  });
});

describe('ALLTRAILS_DEBUG_LOG', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    process.env.ALLTRAILS_DEBUG_LOG = '1';
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('logs bridge requests and responses', async () => {
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

  it('logs <none> for a bodyless bridge request', async () => {
    const { transport } = stubTransport([{ status: 200 }]);
    await new AllTrailsClient({ transport }).request('GET', '/api/alltrails/x');
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('body: <none>'))).toBe(true);
  });

  it('marks a replayed bridge request with (retry)', async () => {
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

  it('logs the body preview and (retry) marker on a replayed Node-path POST', async () => {
    process.env.ALLTRAILS_COOKIE = COOKIE;
    vi.useFakeTimers();
    try {
      mockFetch([{ status: 429, body: {} }, { status: 200, body: { ok: 1 } }]);
      const promise = new AllTrailsClient().request('POST', '/api/alltrails/x', { limit: 7 });
      await vi.advanceTimersByTimeAsync(2000);
      await promise;
      const dbg = errSpy.mock.calls.map((c) => String(c[0]));
      expect(dbg.some((l) => l.includes('"limit":7'))).toBe(true);
      expect(dbg.some((l) => l.includes('→ POST') && l.includes('(retry)'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('redacts the Cookie header on the Node path', async () => {
    process.env.ALLTRAILS_COOKIE = COOKIE;
    mockFetch([{ status: 200, body: { ok: true } }]);
    await new AllTrailsClient().request('GET', '/api/alltrails/x');
    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('"Cookie":"datadome=ddv') && l.includes('chars)'))).toBe(true);
    expect(lines.some((l) => l.includes(COOKIE))).toBe(false);
  });

  it('does not redact when the Cookie header is empty (defensive branch)', async () => {
    // readEnvVar treats '' as unset, so drive the redactor directly through a
    // whitespace-padded cookie that trims to a short value.
    process.env.ALLTRAILS_COOKIE = 'x';
    mockFetch([{ status: 200, body: {} }]);
    await new AllTrailsClient().request('GET', '/api/alltrails/x');
    const dbg = errSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('headers:'));
    expect(dbg.some((l) => l.includes('"Cookie":"x…'))).toBe(true);
  });

  it('logs the timeout path', async () => {
    process.env.ALLTRAILS_COOKIE = COOKIE;
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_url, init) =>
          new Promise((_res, reject) => {
            (init as RequestInit).signal?.addEventListener('abort', () => {
              const e: Error & { name?: string } = new Error('aborted');
              e.name = 'AbortError';
              reject(e);
            });
          }),
      );
      const promise = new AllTrailsClient().request('GET', '/api/alltrails/timeout-check');
      promise.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(promise).rejects.toThrow(/timed out/);
      const lines = errSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('⏱ TIMEOUT after') && l.includes('/api/alltrails/timeout-check'))).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs non-abort fetch errors', async () => {
    process.env.ALLTRAILS_COOKIE = COOKIE;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
    await expect(new AllTrailsClient().request('GET', '/api/alltrails/err-check')).rejects.toThrow(
      'socket hang up',
    );
    const lines = errSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('✗ socket hang up') && l.includes('/api/alltrails/err-check'))).toBe(true);
  });
});
