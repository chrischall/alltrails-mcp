import { describe, it, expect, vi, afterEach } from 'vitest';
import { AllTrailsClient } from '../../src/client.js';
import {
  jsonResponse,
  textResponse,
  resolveUserId,
  summarizeTrail,
  summarizeTrailDetail,
  fetchTrailListing,
} from '../../src/tools/_shared.js';

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

describe('summarizeTrail', () => {
  it('projects the full documented field set', () => {
    expect(summarizeTrail({
      objectID: 10236086,
      name: 'Angels Landing',
      slug: 'us/utah/angels-landing-trail',
      length: 8047,
      elevation_gain: 452,
      difficulty_rating: 5,
      avg_rating: 4.8,
      num_reviews: 12000,
      area_name: 'Zion National Park',
      state_name: 'Utah',
      popularity: 0.99,
    })).toEqual({
      id: '10236086',
      name: 'Angels Landing',
      slug: 'us/utah/angels-landing-trail',
      lengthMeters: 8047,
      lengthMiles: 5,
      elevationGainMeters: 452,
      elevationGainFeet: 1483,
      difficulty: 5,
      rating: 4.8,
      numReviews: 12000,
      area: 'Zion National Park',
      region: 'Utah',
      popularity: 0.99,
    });
  });

  it('falls back across the id variants (objectID → ID → id)', () => {
    expect(summarizeTrail({ ID: 42 }).id).toBe('42');
    expect(summarizeTrail({ id: '7' }).id).toBe('7');
  });

  it('leaves id undefined when no id variant is present', () => {
    expect(summarizeTrail({ name: 'Nameless' }).id).toBeUndefined();
  });

  it('omits imperial conversions when the metric fields are absent', () => {
    const s = summarizeTrail({ name: 'Nameless' });
    expect(s.lengthMiles).toBeUndefined();
    expect(s.elevationGainFeet).toBeUndefined();
  });
});

describe('summarizeTrailDetail', () => {
  it('adds overview, route type, and location to the listing summary', () => {
    expect(summarizeTrailDetail({
      id: 7,
      name: 'Rim Trail',
      length: 1609.344,
      overview: 'A scenic rim walk.',
      routeType: { name: 'Out & back' },
      location: { latitude: 36.06, longitude: -112.14, city: 'Grand Canyon', region: 'Arizona', country: 'United States' },
    })).toEqual({
      id: '7',
      name: 'Rim Trail',
      lengthMeters: 1609.344,
      lengthMiles: 1,
      overview: 'A scenic rim walk.',
      routeType: 'Out & back',
      location: { latitude: 36.06, longitude: -112.14, city: 'Grand Canyon', region: 'Arizona', country: 'United States' },
    });
  });

  it('leaves detail fields undefined when absent', () => {
    const s = summarizeTrailDetail({ id: 1 });
    expect(s.overview).toBeUndefined();
    expect(s.routeType).toBeUndefined();
    expect(s.location).toBeUndefined();
  });

  it('drops a present-but-empty location object instead of emitting {}', () => {
    // A location object whose subfields are all absent must not serialize to {}.
    const s = summarizeTrailDetail({ id: 1, location: { city: undefined } });
    expect(s.location).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('location');
  });

  it('keeps location when at least one subfield is present', () => {
    const s = summarizeTrailDetail({ id: 1, location: { city: 'Moab' } });
    expect(s.location).toEqual({ city: 'Moab' });
  });
});

describe('fetchTrailListing', () => {
  const listing = {
    trails: [
      { objectID: 1, name: 'A', length: 1000, difficulty_rating: 3, avg_rating: 4.1 },
      { objectID: 2, name: 'B' },
    ],
  };

  it('returns a slim summary array when compact is true', async () => {
    const c = clientReturning(listing);
    const result = await fetchTrailListing(c, '/api/alltrails/locations/states/9/trails', 'ctx', true);
    expect(c.request).toHaveBeenCalledWith('GET', '/api/alltrails/locations/states/9/trails');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.count).toBe(2);
    expect(parsed.trails[0]).toEqual({
      id: '1', name: 'A', lengthMeters: 1000, lengthMiles: 0.62, difficulty: 3, rating: 4.1,
    });
    expect(parsed.trails[1]).toEqual({ id: '2', name: 'B' });
  });

  it('returns the raw response when compact is false', async () => {
    const c = clientReturning(listing);
    const result = await fetchTrailListing(c, '/x', 'ctx', false);
    expect(JSON.parse(result.content[0].text)).toEqual(listing);
  });

  it('falls back to the raw response when compact is true but the shape drifted (no trails array)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const drifted = { results: [{ name: 'X' }] }; // `trails` absent
    const c = clientReturning(drifted);
    const result = await fetchTrailListing(c, '/x', 'GET listing', true);
    expect(JSON.parse(result.content[0].text)).toEqual(drifted);
    // A present-but-wrong shape would warn; an absent optional key does not.
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('warns and falls back to raw when trails is present but the wrong type', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bad = { trails: 'not-an-array' };
    const c = clientReturning(bad);
    const result = await fetchTrailListing(c, '/x', 'GET listing', true);
    expect(JSON.parse(result.content[0].text)).toEqual(bad);
    expect(String(errSpy.mock.calls[0][0])).toContain('GET listing');
  });
});
