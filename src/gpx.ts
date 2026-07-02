import { z } from 'zod';

// GPX export from `GET /v3/trails/{id}?detail=offline` route geometry.
//
// Captured 2026-07-02: trails[0].defaultMap.routes[].lineSegments[].polyline
// carries the track as a Google encoded polyline:
//   - `pointsData`            — 2-dim (lat, lng), precision 1e5
//   - `indexedElevationData`  — 2-dim (pointIndex×100, elevationMeters×1e5),
//                               exactly one pair per track point
//   - `elevationData`         — null in the capture; ignored
// Verified against Mount Healy Overlook (10236086): decoded first point equals
// the route's own location field, and elevations span 538.92→1059.18 m.

/**
 * Decode a Google encoded polyline into `dims`-dimensional points, dividing
 * each value by `factor`. Standard varint/zigzag delta decoding, generalized
 * over the dimension count so it serves both the lat/lng stream and the
 * (index, elevation) stream.
 */
export function decodePolyline(encoded: string, dims: number, factor: number): number[][] {
  const out: number[][] = [];
  const coord = new Array<number>(dims).fill(0);
  let index = 0;
  while (index < encoded.length) {
    const point: number[] = [];
    for (let d = 0; d < dims; d++) {
      let result = 0;
      let shift = 0;
      let byte: number;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      coord[d] += result & 1 ? ~(result >> 1) : result >> 1;
      point.push(coord[d] / factor);
    }
    out.push(point);
  }
  return out;
}

// Only the geometry-bearing fields — loose, as always.
const PolylineSchema = z.looseObject({
  pointsData: z.string().nullish(),
  indexedElevationData: z.string().nullish(),
});
export const OfflineTrailSchema = z.looseObject({
  trails: z
    .array(
      z.looseObject({
        name: z.string().nullish(),
        defaultMap: z
          .looseObject({
            routes: z
              .array(z.looseObject({ lineSegments: z.array(z.looseObject({ polyline: PolylineSchema.nullish() })).nullish() }))
              .nullish(),
          })
          .nullish(),
      }),
    )
    .optional(),
});
type OfflineTrail = z.infer<typeof OfflineTrailSchema>;

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a GPX 1.1 document from an offline-detail trail response: one <trk>,
 * one <trkseg> per line segment (across all routes), <ele> per point when the
 * indexed elevation stream is present. Throws an actionable error when the
 * response carries no decodable geometry (shape drift, or a trail without a
 * verified map).
 */
export function trailToGpx(raw: OfflineTrail): string {
  const trail = raw.trails?.[0];
  const name = trail?.name ?? 'AllTrails trail';
  const segments: string[] = [];
  for (const route of trail?.defaultMap?.routes ?? []) {
    for (const segment of route.lineSegments ?? []) {
      const pointsData = segment.polyline?.pointsData;
      if (!pointsData) continue;
      const points = decodePolyline(pointsData, 2, 1e5);
      const elevations = segment.polyline?.indexedElevationData
        ? decodePolyline(segment.polyline.indexedElevationData, 2, 1e5)
        : undefined;
      const trkpts = points.map(([lat, lng], i) => {
        const ele = elevations?.[i]?.[1];
        return ele === undefined
          ? `      <trkpt lat="${lat}" lon="${lng}"/>`
          : `      <trkpt lat="${lat}" lon="${lng}"><ele>${ele}</ele></trkpt>`;
      });
      segments.push(`    <trkseg>\n${trkpts.join('\n')}\n    </trkseg>`);
    }
  }
  if (segments.length === 0) {
    throw new Error(
      'AllTrails returned no route geometry for this trail — the offline-detail shape may have drifted, ' +
        'or the trail has no verified map. Try alltrails_get_trail(detail: "offline") to inspect the raw response.',
    );
  }
  const escapedName = escapeXml(name);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="alltrails-mcp" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${escapedName}</name></metadata>`,
    '  <trk>',
    `    <name>${escapedName}</name>`,
    ...segments,
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');
}
