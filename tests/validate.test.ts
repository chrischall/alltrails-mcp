import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';
import { parseAllTrails } from '../src/validate.js';

afterEach(() => vi.restoreAllMocks());

const Schema = z.looseObject({ id: z.number(), name: z.string().optional() });

describe('parseAllTrails', () => {
  it('returns parsed data on a match, preserving unknown keys (loose)', () => {
    const raw = { id: 7, name: 'Trail', extra: 'kept' };
    expect(parseAllTrails(Schema, raw, 'ctx')).toEqual(raw);
  });

  it('lenient (default): warns to stderr and returns the raw response on mismatch', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const raw = { id: 'not-a-number' };
    const out = parseAllTrails(Schema, raw, 'GET /api/alltrails/v3/trails/{id}');
    expect(out).toBe(raw);
    const line = String(errSpy.mock.calls[0][0]);
    expect(line).toContain('[alltrails-mcp] WARNING');
    expect(line).toContain('GET /api/alltrails/v3/trails/{id}');
    expect(line).toContain('id:');
  });

  it('strict: throws with a precise message on mismatch', () => {
    expect(() => parseAllTrails(Schema, { id: 'x' }, 'POST reviews', 'strict')).toThrow(
      /Unexpected POST reviews shape from the upstream API\. id:/,
    );
  });

  it('reports the root path when the whole value is the wrong type', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    parseAllTrails(Schema, 'totally wrong', 'ctx');
    expect(String(errSpy.mock.calls[0][0])).toContain('(root)');
  });
});
