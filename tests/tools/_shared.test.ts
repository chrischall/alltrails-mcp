import { describe, it, expect, vi, afterEach } from 'vitest';
import { AllTrailsClient } from '../../src/client.js';
import { jsonResponse, textResponse, resolveUserId } from '../../src/tools/_shared.js';

afterEach(() => {
  delete process.env.ALLTRAILS_USER_ID;
  vi.restoreAllMocks();
});

function clientReturning(value: unknown) {
  const c = new AllTrailsClient();
  vi.spyOn(c, 'request').mockResolvedValue(value);
  return c;
}

describe('jsonResponse', () => {
  it('wraps a payload as a single pretty-printed text block', () => {
    const result = jsonResponse({ foo: 'bar', n: 1 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe('{\n  "foo": "bar",\n  "n": 1\n}');
  });
});

describe('textResponse', () => {
  it('wraps a string with no JSON-encoding', () => {
    expect(textResponse('hello').content[0]).toEqual({ type: 'text', text: 'hello' });
  });
});

describe('resolveUserId', () => {
  it('returns an explicitly provided id without calling /me', async () => {
    const c = clientReturning({});
    expect(await resolveUserId(c, '999')).toBe('999');
    expect(c.request).not.toHaveBeenCalled();
  });

  it('falls back to ALLTRAILS_USER_ID when the arg is blank', async () => {
    process.env.ALLTRAILS_USER_ID = '555';
    const c = clientReturning({});
    expect(await resolveUserId(c, '   ')).toBe('555');
    expect(c.request).not.toHaveBeenCalled();
  });

  it('resolves via /api/alltrails/me when nothing is provided (user.id)', async () => {
    const c = clientReturning({ user: { id: 42, name: 'Chris' } });
    expect(await resolveUserId(c)).toBe('42');
    expect(c.request).toHaveBeenCalledWith('GET', '/api/alltrails/me');
  });

  it('falls back to a top-level id when user.id is absent', async () => {
    const c = clientReturning({ id: '77' });
    expect(await resolveUserId(c)).toBe('77');
  });

  it('throws an actionable error when /me yields no id (not signed in)', async () => {
    const c = clientReturning({});
    await expect(resolveUserId(c)).rejects.toThrow(/Could not determine your AllTrails user id/);
  });
});
