import { describe, it, expect, vi, afterEach } from 'vitest';
import { AllTrailsClient } from '../../src/client.js';
import {
  jsonResponse,
  textResponse,
  resolveUserId,
  summarizeTrail,
  summarizeTrailDetail,
  summarizePhoto,
  summarizeSearchResult,
  summarizeFeedItem,
  summarizeListItem,
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

  it('resolves via the users[] envelope the live /me actually returns', async () => {
    // Captured 2026-07-02: GET /api/alltrails/me → { users: [{ id, ... }] }
    const c = clientReturning({ users: [{ id: 12345678, username: 'some-hiker' }] });
    expect(await resolveUserId(c)).toBe('12345678');
  });

  it('throws an actionable error when /me yields no id (not signed in)', async () => {
    const c = clientReturning({});
    await expect(resolveUserId(c)).rejects.toThrow(/Could not determine your AllTrails user id/);
  });

  it('throws when the users[] envelope is empty', async () => {
    const c = clientReturning({ users: [] });
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

describe('summarizePhoto', () => {
  it('projects the captured photo shape, deriving a fetchable image url', () => {
    // Captured 2026-07-02: GET /api/alltrails/v2/trails/{id}/photos → { photos: [...] }
    expect(summarizePhoto({
      id: 49001265,
      title: 'Summit view',
      description: null,
      likeCount: 3,
      photoHash: '3bb1d835d02a8e22989c0c813a2794ce',
      trailId: 10236086,
      location: { postalCode: null, city: null, latitude: 63.7424617, longitude: -148.9533833 },
      user: { id: 23711569, firstName: 'Connie', lastName: 'Blade' },
      metadata: { created: '2022-07-02T21:07:21Z', status: 'A' },
    }, 'live-captured-key')).toEqual({
      id: '49001265',
      title: 'Summit view',
      likeCount: 3,
      user: 'Connie Blade',
      uploadedAt: '2022-07-02T21:07:21Z',
      latitude: 63.7424617,
      longitude: -148.9533833,
      url: 'https://www.alltrails.com/api/alltrails/photos/49001265/image?size=large&key=live-captured-key',
    });
  });

  it('omits the key param when no captured key is available yet', () => {
    const s = summarizePhoto({ id: 7 });
    expect(s.url).toBe('https://www.alltrails.com/api/alltrails/photos/7/image?size=large');
  });

  it('drops empty title, null description, and omits the url when the id is missing', () => {
    const s = summarizePhoto({ title: '', description: null });
    expect(s.title).toBeUndefined();
    expect(s.description).toBeUndefined();
    expect(s.url).toBeUndefined();
    expect(JSON.stringify(s)).toBe('{}');
  });

  it('keeps a non-empty description and a single-name user', () => {
    const s = summarizePhoto({ id: '5', description: 'Great falls', user: { firstName: 'Ana' } });
    expect(s.description).toBe('Great falls');
    expect(s.user).toBe('Ana');
  });

  it('url-encodes the photo id in the derived image url', () => {
    // Defensive: ids are numeric in practice, but every other path-param
    // interpolation in the repo encodes — keep the URL safe under drift.
    const s = summarizePhoto({ id: 'a/b?c' });
    expect(s.url).toContain('/api/alltrails/photos/a%2Fb%3Fc/image');
  });

  it('maps the explicit nulls the live payload carries to omitted fields', () => {
    const s = summarizePhoto({
      id: 9,
      likeCount: null,
      location: { latitude: null, longitude: null },
      user: { firstName: null, lastName: null },
      metadata: { created: null },
    });
    expect(s.likeCount).toBeUndefined();
    expect(s.latitude).toBeUndefined();
    expect(s.longitude).toBeUndefined();
    expect(s.user).toBeUndefined();
    expect(s.uploadedAt).toBeUndefined();
  });
});

describe('summarizeSearchResult', () => {
  it('prefers the numeric ID over the prefixed objectID and projects search extras', () => {
    // Captured 2026-07-02: POST /api/alltrails/explore/v1/search → searchResults[]
    expect(summarizeSearchResult({
      ID: 10376954,
      objectID: 'trail-10376954',
      type: 'trail',
      name: 'Los Angeles Historic Park',
      slug: 'trail/us/california/los-angeles-historic-park',
      length: 1770.274,
      elevation_gain: 4.8768,
      difficulty_rating: '1',
      avg_rating: 4.6,
      num_reviews: 591,
      area_name: 'Los Angeles State Historic Park',
      state_name: 'California',
      city_name: 'Dodgertown',
      country_name: 'United States',
      duration_minutes: 20,
      is_closed: false,
      popularity: 93.8056,
    })).toEqual({
      id: '10376954',
      type: 'trail',
      name: 'Los Angeles Historic Park',
      slug: 'trail/us/california/los-angeles-historic-park',
      lengthMeters: 1770.274,
      lengthMiles: 1.1,
      elevationGainMeters: 4.8768,
      elevationGainFeet: 16,
      difficulty: '1',
      rating: 4.6,
      numReviews: 591,
      area: 'Los Angeles State Historic Park',
      region: 'California',
      city: 'Dodgertown',
      country: 'United States',
      durationMinutes: 20,
      closed: false,
      popularity: 93.8056,
    });
  });

  it('falls back to objectID when no numeric id variant is present', () => {
    expect(summarizeSearchResult({ objectID: 'trail-42' }).id).toBe('trail-42');
  });

  it('maps null search extras (and a missing id) to omitted fields', () => {
    const s = summarizeSearchResult({
      type: null,
      city_name: null,
      country_name: null,
      duration_minutes: null,
      is_closed: null,
    });
    expect(s.id).toBeUndefined();
    expect(s.type).toBeUndefined();
    expect(s.city).toBeUndefined();
    expect(s.country).toBeUndefined();
    expect(s.durationMinutes).toBeUndefined();
    expect(s.closed).toBeUndefined();
  });
});

describe('summarizeFeedItem', () => {
  // Captured 2026-07-02: GET .../feeds/{local|timeline|personal} →
  // { sections: [{ section_type: 'feed-item', itemData: {...} }], pageInfo }
  const capturedItemData = {
    itemID: '11265880-70a0-11f1-8080-8000276183d4',
    itemType: 'activity:created',
    timestamp: '2026-06-25T13:38:58.000Z',
    description:
      'Hiked <a data-id="10305376" rel="alltrails:trail" href="/trail/us/arizona/north-mountain-national-trail--4">North Mountain National Trail</a>',
    user: { id: 112285977, firstName: 'Jade', lastName: 'Sandoval', slug: 'jade-sandoval-4' },
    trail: { id: 10305376, name: 'North Mountain National Trail', slug: 'us/arizona/north-mountain-national-trail--4' },
    activity: {
      id: 394302462,
      name: 'Morning hike at North Mountain National Trail',
      rating: 4,
      activity: { uid: 'hiking', name: 'Hiking' },
      summaryStats: {
        calories: 299,
        distanceTotal: 2485.81,
        duration: 34,
        elevationGain: 172,
        elevationLoss: 167,
        timeMoving: 2066,
        timeTotal: 2066,
      },
    },
    review: { id: 71319107, rating: 4, comment: '' },
  };

  it('projects the captured activity feed item, stripping html from the description', () => {
    expect(summarizeFeedItem(capturedItemData)).toEqual({
      type: 'activity:created',
      timestamp: '2026-06-25T13:38:58.000Z',
      description: 'Hiked North Mountain National Trail',
      user: 'Jade Sandoval',
      trail: { id: '10305376', name: 'North Mountain National Trail', slug: 'us/arizona/north-mountain-national-trail--4' },
      activity: {
        type: 'Hiking',
        name: 'Morning hike at North Mountain National Trail',
        rating: 4,
        distanceMeters: 2485.81,
        distanceMiles: 1.54,
        durationMinutes: 34,
        elevationGainMeters: 172,
        elevationGainFeet: 564,
      },
      review: { rating: 4 },
    });
  });

  it('decodes html entities left behind after stripping tags', () => {
    const s = summarizeFeedItem({
      itemType: 'activity:created',
      description: 'Hiked <a href="/trail/x">Bob &amp; Alice&#39;s &quot;Loop&quot; &lt;Trail&gt;&nbsp;#2</a>',
    });
    expect(s.description).toBe('Hiked Bob & Alice\'s "Loop" <Trail> #2');
  });

  it('decodes numeric hex entities and apos, and does not double-decode &amp;lt;', () => {
    const s = summarizeFeedItem({
      itemType: 'activity:created',
      description: 'It&#x2019;s O&apos;Malley&#x27;s — literally &amp;lt; that',
    });
    expect(s.description).toBe("It’s O'Malley's — literally &lt; that");
  });

  it('drops empty nested objects instead of emitting {}', () => {
    const s = summarizeFeedItem({ itemType: 'user:connected' });
    expect(s).toEqual({ type: 'user:connected' });
    expect(JSON.stringify(s)).toBe('{"type":"user:connected"}');
  });

  it('maps the explicit nulls the live payload carries to omitted fields', () => {
    const s = summarizeFeedItem({
      itemType: null,
      timestamp: null,
      description: null,
      user: { firstName: null, lastName: null },
      trail: { name: null, slug: null },
      activity: {
        name: null,
        rating: null,
        activity: { name: null },
        summaryStats: { distanceTotal: null, duration: null, elevationGain: null },
      },
      review: { rating: null, comment: null },
    });
    expect(s).toEqual({});
    expect(JSON.stringify(s)).toBe('{}');
  });

  it('keeps a review comment when present and tolerates a stats-less activity', () => {
    const s = summarizeFeedItem({
      itemType: 'review:created',
      review: { rating: 5, comment: 'Lovely loop.' },
      activity: { name: 'Afternoon walk' },
    });
    expect(s.review).toEqual({ rating: 5, comment: 'Lovely loop.' });
    expect(s.activity).toEqual({ name: 'Afternoon walk' });
  });
});

describe('summarizeListItem', () => {
  it('projects the captured list-item shape (a sparse trail reference)', () => {
    // Captured 2026-07-08: GET /api/alltrails/lists/{id}/items →
    // { listItems: [{ id, listId, type, order, notes, trailId, metadata }] }.
    // Items carry NO trail details — only a trailId to hydrate via get_trail.
    expect(summarizeListItem({
      id: 665396,
      listId: 13572468,
      type: 'trail',
      order: 1,
      notes: 'Great in fall',
      trailId: 10264089,
      metadata: { status: 'A', created: '2017-08-11T16:50:35Z', updated: '2022-04-29T19:56:02Z' },
    })).toEqual({
      trailId: '10264089',
      type: 'trail',
      order: 1,
      notes: 'Great in fall',
      addedAt: '2017-08-11T16:50:35Z',
    });
  });

  it('omits null notes and a missing metadata block', () => {
    const s = summarizeListItem({ trailId: 42, type: 'trail', order: 2, notes: null });
    expect(s).toEqual({ trailId: '42', type: 'trail', order: 2 });
    expect(JSON.stringify(s)).not.toContain('notes');
    expect(JSON.stringify(s)).not.toContain('addedAt');
  });

  it('leaves trailId undefined when absent', () => {
    expect(summarizeListItem({ type: 'map', order: 1 }).trailId).toBeUndefined();
  });

  it('maps null type and order to omitted fields', () => {
    const s = summarizeListItem({ trailId: 7, type: null, order: null, notes: null });
    expect(s).toEqual({ trailId: '7' });
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
