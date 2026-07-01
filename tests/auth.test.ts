import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// resolveAuth() drives three paths:
//   1. ALLTRAILS_COOKIE env → use verbatim as the Cookie header
//   2. fetchproxy fallback → capture the `cookie` + `x-at-key` request headers
//   3. error: AllTrailsConfigError (permanent) telling the user how to fix it
//
// @fetchproxy/bootstrap is mocked at the module boundary — never hit a real WS.
const bootstrapMock = vi.fn();
vi.mock('@fetchproxy/bootstrap', () => ({
  bootstrap: (...args: unknown[]) => bootstrapMock(...args),
}));

import { resolveAuth, AllTrailsConfigError } from '../src/auth.js';

function session(captured: Record<string, string>) {
  return { cookies: {}, localStorage: {}, sessionStorage: {}, capturedHeaders: captured, indexedDb: {} };
}

describe('resolveAuth', () => {
  let originalCookie: string | undefined;
  let originalDisable: string | undefined;

  beforeEach(() => {
    originalCookie = process.env.ALLTRAILS_COOKIE;
    originalDisable = process.env.ALLTRAILS_DISABLE_FETCHPROXY;
    delete process.env.ALLTRAILS_COOKIE;
    delete process.env.ALLTRAILS_DISABLE_FETCHPROXY;
    bootstrapMock.mockReset();
  });

  afterEach(() => {
    if (originalCookie === undefined) delete process.env.ALLTRAILS_COOKIE;
    else process.env.ALLTRAILS_COOKIE = originalCookie;
    if (originalDisable === undefined) delete process.env.ALLTRAILS_DISABLE_FETCHPROXY;
    else process.env.ALLTRAILS_DISABLE_FETCHPROXY = originalDisable;
    vi.restoreAllMocks();
  });

  describe('path 1: env cookie', () => {
    it('uses ALLTRAILS_COOKIE verbatim without invoking fetchproxy', async () => {
      process.env.ALLTRAILS_COOKIE = 'datadome=abc; _at_session=xyz';
      const result = await resolveAuth();
      expect(result).toEqual({ cookieHeader: 'datadome=abc; _at_session=xyz', source: 'env' });
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it('treats a sanitized/placeholder cookie as unset and falls through to fetchproxy', async () => {
      process.env.ALLTRAILS_COOKIE = '${ALLTRAILS_COOKIE}';
      bootstrapMock.mockResolvedValue(session({ cookie: 'dd=1' }));
      const result = await resolveAuth();
      expect(result.source).toBe('fetchproxy');
    });
  });

  describe('path 2: fetchproxy fallback', () => {
    it('captures the cookie + x-at-key request headers and declares the right scope', async () => {
      bootstrapMock.mockResolvedValue(session({ cookie: 'datadome=zzz; sess=1', 'x-at-key': 'live-key' }));

      const result = await resolveAuth();

      expect(bootstrapMock).toHaveBeenCalledTimes(1);
      const opts = bootstrapMock.mock.calls[0][0] as {
        serverName: string;
        version: string;
        domains: string[];
        declare: { captureHeaders: Array<{ host: string; path: string; headerName: string }> };
      };
      expect(opts.serverName).toBe('alltrails-mcp');
      expect(typeof opts.version).toBe('string');
      expect(opts.domains).toEqual(['alltrails.com']);
      expect(opts.declare.captureHeaders).toEqual([
        { host: 'www.alltrails.com', path: '/api/alltrails/*', headerName: 'cookie' },
        { host: 'www.alltrails.com', path: '/api/alltrails/*', headerName: 'x-at-key' },
      ]);
      expect(result).toEqual({ cookieHeader: 'datadome=zzz; sess=1', apiKey: 'live-key', source: 'fetchproxy' });
    });

    it('leaves apiKey undefined when x-at-key was not captured', async () => {
      bootstrapMock.mockResolvedValue(session({ cookie: 'datadome=zzz', 'x-at-key': '' }));
      const result = await resolveAuth();
      expect(result.apiKey).toBeUndefined();
    });

    it('surfaces the onWaiting hint to stderr', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      bootstrapMock.mockImplementation(async (opts: { onWaiting?: (h: string) => void }) => {
        opts.onWaiting?.('capture request header');
        return session({ cookie: 'datadome=zzz' });
      });

      await resolveAuth();

      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('capture request header'))).toBe(true);
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('www.alltrails.com'))).toBe(true);
    });

    it('throws when no authenticated request was captured', async () => {
      bootstrapMock.mockResolvedValue(session({}));
      await expect(resolveAuth()).rejects.toThrow(/no authenticated request/);
      await expect(resolveAuth()).rejects.toThrow(/fetchproxy fallback failed/);
    });

    it('wraps a plain bootstrap() error with actionable context', async () => {
      bootstrapMock.mockRejectedValue(new Error('extension offline'));
      await expect(resolveAuth()).rejects.toThrow(/fetchproxy fallback failed: extension offline/);
    });

    it('handles non-Error rejections from bootstrap()', async () => {
      bootstrapMock.mockRejectedValue('plain string failure');
      await expect(resolveAuth()).rejects.toThrow(/fetchproxy fallback failed: plain string failure/);
    });

    it('surfaces FetchproxyBridgeDownError.hint verbatim when the SW retry exhausts', async () => {
      const { FetchproxyBridgeDownError } = await import('@chrischall/mcp-utils/fetchproxy');
      const downErr = new FetchproxyBridgeDownError({
        originalError: 'content_script_unreachable',
        retryAttempted: true,
        op: 'fetch',
      });
      bootstrapMock.mockRejectedValue(downErr);
      await expect(resolveAuth()).rejects.toThrow(/fetchproxy bridge is down/);
      await expect(resolveAuth()).rejects.toThrow(downErr.hint.slice(0, 20));
    });
  });

  describe('path 3: nothing configured', () => {
    it('throws a permanent AllTrailsConfigError when fetchproxy is disabled', async () => {
      process.env.ALLTRAILS_DISABLE_FETCHPROXY = '1';
      const err = await resolveAuth().catch((e) => e);
      expect(err).toBeInstanceOf(AllTrailsConfigError);
      expect(err.name).toBe('AllTrailsConfigError');
      expect(String(err.message)).toMatch(/set ALLTRAILS_COOKIE/);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });

    it.each(['1', 'true', 'yes', 'on'])('treats ALLTRAILS_DISABLE_FETCHPROXY=%j as disabled', async (v) => {
      process.env.ALLTRAILS_DISABLE_FETCHPROXY = v;
      await expect(resolveAuth()).rejects.toBeInstanceOf(AllTrailsConfigError);
      expect(bootstrapMock).not.toHaveBeenCalled();
    });
  });
});
