import { describe, it, expect } from 'vitest';
import { decodePolyline, trailToGpx } from '../src/gpx.js';

// Standard Google polyline encoder (test-side only) so fixtures are built from
// known coordinates instead of hand-crafted encoded strings.
function encode(values: number[][], factor: number): string {
  let out = '';
  const prev = new Array(values[0]?.length ?? 0).fill(0);
  for (const point of values) {
    for (let d = 0; d < point.length; d++) {
      const v = Math.round(point[d] * factor);
      let delta = v - prev[d];
      prev[d] = v;
      delta = delta < 0 ? ~(delta << 1) : delta << 1;
      while (delta >= 0x20) {
        out += String.fromCharCode((0x20 | (delta & 0x1f)) + 63);
        delta >>= 5;
      }
      out += String.fromCharCode(delta + 63);
    }
  }
  return out;
}

describe('decodePolyline', () => {
  it('round-trips 2-dim lat/lng points at precision 5, including negative deltas', () => {
    const pts = [
      [63.7315, -148.91909],
      [63.73153, -148.91916],
      [63.73149, -148.91928],
    ];
    expect(decodePolyline(encode(pts, 1e5), 2, 1e5)).toEqual(pts);
  });

  it('decodes a 2-dim indexed elevation stream (index, elevation×1e5)', () => {
    const pairs = [
      [0, 538.92],
      [100, 539.57],
      [200, 540.14],
    ];
    const encoded = encode(pairs.map(([i, e]) => [i, e]), 1e5);
    expect(decodePolyline(encoded, 2, 1e5)).toEqual(pairs);
  });

  it('returns an empty array for an empty string', () => {
    expect(decodePolyline('', 2, 1e5)).toEqual([]);
  });
});

describe('trailToGpx', () => {
  // Mirrors the captured `GET /v3/trails/{id}?detail=offline` shape
  // (2026-07-02): trails[0].defaultMap.routes[].lineSegments[].polyline.
  const points = [
    [63.7315, -148.91909],
    [63.73153, -148.91916],
  ];
  const elevations = [
    [0, 538.92],
    [100, 539.57],
  ];
  const capturedShape = {
    trails: [
      {
        id: 10236086,
        name: 'Mount Healy <Overlook> & Co',
        defaultMap: {
          routes: [
            {
              lineSegments: [
                {
                  polyline: {
                    pointsData: encode(points, 1e5),
                    elevationData: null,
                    indexedElevationData: encode(elevations, 1e5),
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };

  it('builds GPX 1.1 with per-point elevation and an xml-escaped name', () => {
    const gpx = trailToGpx(capturedShape);
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx version="1.1" creator="alltrails-mcp"');
    expect(gpx).toContain('<name>Mount Healy &lt;Overlook&gt; &amp; Co</name>');
    expect(gpx).toContain('<trkpt lat="63.7315" lon="-148.91909"><ele>538.92</ele></trkpt>');
    expect(gpx).toContain('<trkpt lat="63.73153" lon="-148.91916"><ele>539.57</ele></trkpt>');
  });

  it('omits <ele> when the segment has no elevation stream', () => {
    const noEle = structuredClone(capturedShape);
    noEle.trails[0].defaultMap.routes[0].lineSegments[0].polyline.indexedElevationData = null;
    const gpx = trailToGpx(noEle);
    expect(gpx).toContain('<trkpt lat="63.7315" lon="-148.91909"/>');
    expect(gpx).not.toContain('<ele>');
  });

  it('emits one trkseg per line segment across routes', () => {
    const multi = structuredClone(capturedShape);
    multi.trails[0].defaultMap.routes.push({
      lineSegments: [{ polyline: { pointsData: encode([[64, -149]], 1e5), elevationData: null, indexedElevationData: null } }],
    });
    const gpx = trailToGpx(multi);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
    expect(gpx).toContain('<trkpt lat="64" lon="-149"/>');
  });

  it('throws an actionable error when the response carries no route geometry', () => {
    expect(() => trailToGpx({ trails: [{ id: 1, name: 'X' }] })).toThrow(/no route geometry/i);
    expect(() => trailToGpx({ trails: [] })).toThrow(/no route geometry/i);
    expect(() => trailToGpx({})).toThrow(/no route geometry/i);
  });

  it('falls back to a generic name when the trail has none', () => {
    const unnamed = structuredClone(capturedShape);
    unnamed.trails[0].name = undefined as unknown as string;
    expect(trailToGpx(unnamed)).toContain('<name>AllTrails trail</name>');
  });

  it('skips routes that carry no lineSegments at all', () => {
    const sparse = structuredClone(capturedShape);
    sparse.trails[0].defaultMap.routes.push({} as (typeof sparse.trails)[0]['defaultMap']['routes'][0]);
    const gpx = trailToGpx(sparse);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
  });

  it('skips segments whose pointsData is missing', () => {
    const sparse = structuredClone(capturedShape);
    sparse.trails[0].defaultMap.routes[0].lineSegments.push({
      polyline: { pointsData: null as unknown as string, elevationData: null, indexedElevationData: null },
    });
    const gpx = trailToGpx(sparse);
    expect(gpx.match(/<trkseg>/g)).toHaveLength(1);
  });
});
