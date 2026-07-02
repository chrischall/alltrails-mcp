import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AllTrailsClient } from '../src/client.js';
import * as auth from '../src/auth.js';

const COOKIE = 'datadome=ddvalue; _at_session=sess1';

interface MockResponse {
  status: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

// Login uses the env-cookie path (no network), so the ONLY fetches are the API
// calls themselves. Each entry maps to one API request in order.
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

describe('AllTrailsClient', () => {
  beforeEach(() => {
    process.env.ALLTRAILS_COOKIE = COOKIE;
  });
  afterEach(() => {
    delete process.env.ALLTRAILS_COOKIE;
    delete process.env.ALLTRAILS_DISABLE_FETCHPROXY;
    delete process.env.ALLTRAILS_DEBUG_LOG;
    delete process.env.ALLTRAILS_REQUEST_TIMEOUT_MS;
    vi.restoreAllMocks();
  });

  it('sends Cookie + protocol headers and no Content-Type on GET', async () => {
    const spy = mockFetch([{ status: 200, body: { ok: true } }]);
    const client = new AllTrailsClient();
    const result = await client.request<{ ok: boolean }>('GET', '/api/alltrails/v3/trails/1');

    expect(result).toEqual({ ok: true });
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

  it('prefers a live captured x-at-key over the default', async () => {
    vi.spyOn(auth, 'resolveAuth').mockResolvedValue({ cookieHeader: COOKIE, apiKey: 'live-key', source: 'fetchproxy' });
    const spy = mockFetch([{ status: 200, body: {} }]);
    const client = new AllTrailsClient();
    await client.request('GET', '/api/alltrails/me');
    const h = (spy.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(h['x-at-key']).toBe('live-key');
  });

  it('sends a JSON body + Content-Type on POST', async () => {
    const spy = mockFetch([{ status: 200, body: {} }]);
    const client = new AllTrailsClient();
    await client.request('POST', '/api/alltrails/v2/trails/1/reviews/search', { limit: 5 });
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.body).toBe(JSON.stringify({ limit: 5 }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('parses an empty response body as null', async () => {
    mockFetch([{ status: 200, text: '' }]);
    const client = new AllTrailsClient();
    const result = await client.request('GET', '/api/alltrails/x');
    expect(result).toBeNull();
  });

  it('throws an actionable error when a 2xx body is not JSON (DataDome interstitial)', async () => {
    mockFetch([{ status: 200, text: '<html><body>Please verify you are human</body></html>' }]);
    const client = new AllTrailsClient();
    const err = await client.request('GET', '/api/alltrails/x').catch((e) => e as Error);
    expect(err.message).toContain('non-JSON for GET /api/alltrails/x');
    expect(err.message).toContain('DataDome');
    expect(err.message).toContain('<html><body>Please verify');
  });

  it('single-flights login and reuses the session across requests', async () => {
    const spy = vi.spyOn(auth, 'resolveAuth');
    mockFetch([{ status: 200, body: {} }, { status: 200, body: {} }]);
    const client = new AllTrailsClient();
    await client.request('GET', '/api/alltrails/a');
    await client.request('GET', '/api/alltrails/b');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('re-captures the session and replays once on 403 (DataDome expiry)', async () => {
    const spy = vi.spyOn(auth, 'resolveAuth');
    const fetchSpy = mockFetch([{ status: 403, body: {} }, { status: 200, body: { ok: true } }]);
    const client = new AllTrailsClient();
    const result = await client.request<{ ok: boolean }>('GET', '/api/alltrails/x');
    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledTimes(2); // initial login + re-login after expiry
  });

  it('re-captures the session and replays once on 401', async () => {
    const fetchSpy = mockFetch([{ status: 401, body: {} }, { status: 200, body: { ok: 1 } }]);
    const client = new AllTrailsClient();
    await client.request('GET', '/api/alltrails/x');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('throws with a DataDome hint on a persistent 403', async () => {
    mockFetch([{ status: 403, body: {} }, { status: 403, body: {} }]);
    const client = new AllTrailsClient();
    await expect(client.request('GET', '/api/alltrails/x')).rejects.toThrow(/DataDome bot protection/);
  });

  it('throws a generic error (no DataDome hint) on a 500', async () => {
    mockFetch([{ status: 500, body: {} }]);
    const client = new AllTrailsClient();
    const err = await client.request('GET', '/api/alltrails/x').catch((e) => e as Error);
    expect(err.message).toContain('AllTrails API error: 500');
    expect(err.message).not.toContain('DataDome');
  });

  it('waits 2s and replays once on 429', async () => {
    vi.useFakeTimers();
    try {
      const spy = mockFetch([{ status: 429, body: {} }, { status: 200, body: { ok: true } }]);
      const client = new AllTrailsClient();
      const promise = client.request('GET', '/api/alltrails/x');
      await vi.advanceTimersByTimeAsync(2000);
      expect(await promise).toEqual({ ok: true });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws "Rate limited" on a second 429', async () => {
    vi.useFakeTimers();
    try {
      mockFetch([{ status: 429, body: {} }, { status: 429, body: {} }]);
      const client = new AllTrailsClient();
      const promise = client.request('GET', '/api/alltrails/x');
      promise.catch(() => {});
      await vi.advanceTimersByTimeAsync(2000);
      await expect(promise).rejects.toThrow('Rate limited');
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors a delta-seconds Retry-After on 429', async () => {
    vi.useFakeTimers();
    try {
      const spy = mockFetch([
        { status: 429, body: {}, headers: { 'retry-after': '5' } },
        { status: 200, body: { ok: true } },
      ]);
      const client = new AllTrailsClient();
      const promise = client.request('GET', '/api/alltrails/x');
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
      const client = new AllTrailsClient();
      const promise = client.request('GET', '/api/alltrails/x');
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

  it('caches a permanent config error and logs in only once', async () => {
    delete process.env.ALLTRAILS_COOKIE;
    process.env.ALLTRAILS_DISABLE_FETCHPROXY = '1';
    const spy = vi.spyOn(auth, 'resolveAuth');
    const client = new AllTrailsClient();
    await expect(client.request('GET', '/api/alltrails/x')).rejects.toThrow(/set ALLTRAILS_COOKIE/);
    await expect(client.request('GET', '/api/alltrails/x')).rejects.toThrow(/set ALLTRAILS_COOKIE/);
    expect(spy).toHaveBeenCalledTimes(1);
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
        const client = new AllTrailsClient();
        const promise = client.request('GET', '/api/alltrails/v3/trails/9');
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
        const client = new AllTrailsClient();
        const promise = client.request('GET', '/api/alltrails/x');
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
        const client = new AllTrailsClient();
        const result = await client.request<{ ok: boolean }>('GET', '/api/alltrails/x');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(result).toEqual({ ok: true });
      } finally {
        vi.useRealTimers();
      }
    });

    it('propagates non-abort fetch errors unchanged', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED'));
      const client = new AllTrailsClient();
      await expect(client.request('GET', '/api/alltrails/x')).rejects.toThrow('connect ECONNREFUSED');
    });
  });

  describe('ALLTRAILS_DEBUG_LOG', () => {
    let errSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      process.env.ALLTRAILS_DEBUG_LOG = '1';
      errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    it('logs request method/url/redacted-cookie/body and response status+body', async () => {
      mockFetch([{ status: 200, body: { ok: true } }]);
      const client = new AllTrailsClient();
      await client.request('POST', '/api/alltrails/v2/trails/1/reviews/search', { limit: 3 });
      const lines = errSpy.mock.calls.map((c) => String(c[0]));
      const dbg = lines.filter((l) => l.startsWith('[alltrails-debug]'));
      expect(dbg.some((l) => l.includes('→ POST'))).toBe(true);
      expect(dbg.some((l) => l.includes('"limit":3'))).toBe(true);
      // Cookie is redacted (only a prefix + length appears, never the full value).
      expect(dbg.some((l) => l.includes('"Cookie":"datadome=ddv') && l.includes('chars)'))).toBe(true);
      expect(dbg.some((l) => l.includes(COOKIE))).toBe(false);
      expect(dbg.some((l) => l.includes('← 200'))).toBe(true);
      expect(lines.some((l) => l.includes('response body:'))).toBe(true);
    });

    it('logs <none> for a bodyless request', async () => {
      mockFetch([{ status: 200, body: {} }]);
      const client = new AllTrailsClient();
      await client.request('GET', '/api/alltrails/x');
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('body: <none>'))).toBe(true);
    });

    it('marks a replayed request with (retry)', async () => {
      mockFetch([{ status: 403, body: {} }, { status: 200, body: {} }]);
      const client = new AllTrailsClient();
      await client.request('GET', '/api/alltrails/x');
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('(retry)'))).toBe(true);
    });

    it('logs <empty> when the response body is genuinely empty', async () => {
      mockFetch([{ status: 200, text: '' }]);
      const client = new AllTrailsClient();
      await client.request('GET', '/api/alltrails/x');
      expect(errSpy.mock.calls.some((c) => String(c[0]) === '[alltrails-debug] response body: <empty>')).toBe(true);
    });

    it('does not redact when the Cookie header is empty (defensive branch)', async () => {
      vi.spyOn(auth, 'resolveAuth').mockResolvedValue({ cookieHeader: '', source: 'env' });
      mockFetch([{ status: 200, body: {} }]);
      const client = new AllTrailsClient();
      await client.request('GET', '/api/alltrails/x');
      const dbg = errSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('headers:'));
      expect(dbg.some((l) => l.includes('"Cookie":""'))).toBe(true);
    });

    it('logs the timeout path', async () => {
      vi.useFakeTimers();
      try {
        vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) =>
          new Promise((_res, reject) => {
            (init as RequestInit).signal?.addEventListener('abort', () => {
              const e: Error & { name?: string } = new Error('aborted');
              e.name = 'AbortError';
              reject(e);
            });
          }),
        );
        const client = new AllTrailsClient();
        const promise = client.request('GET', '/api/alltrails/timeout-check');
        promise.catch(() => undefined);
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(promise).rejects.toThrow(/timed out/);
        const lines = errSpy.mock.calls.map((c) => String(c[0]));
        expect(lines.some((l) => l.includes('⏱ TIMEOUT after') && l.includes('/api/alltrails/timeout-check'))).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs non-abort fetch errors', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket hang up'));
      const client = new AllTrailsClient();
      await expect(client.request('GET', '/api/alltrails/err-check')).rejects.toThrow('socket hang up');
      const lines = errSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('✗ socket hang up') && l.includes('/api/alltrails/err-check'))).toBe(true);
    });
  });
});
