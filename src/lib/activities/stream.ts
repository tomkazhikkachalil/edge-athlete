// ── The stored stream: build, trim, split, preview — pure ──────────────────
// The stream is what the activity page draws (the map, the elevation / HR /
// pace charts, the splits): columnar, aligned by index, at most
// DISPLAY_POINTS samples, rounded to what a screen can show. It is stored
// UNTRIMMED (the owner sees the whole route); trimStream() is what every
// other viewer gets — Tom's rule: the first and last ~200 m never leave the
// server for anyone but the athlete and their guardians.

import { cumulativeDistances, downsample } from './normalize';
import { encodePolyline, type LatLng } from './polyline';
import type { ActivityPoint, ActivityStream, Split } from './types';

export const DISPLAY_POINTS = 2_000;
export const PREVIEW_POINTS = 200;
/** Tom (Sep 29 2026): the route's first and last ~200 m stay private. */
export const TRIM_M = 200;

const r = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

function column(points: readonly ActivityPoint[], key: 'lat' | 'lng' | 'ele' | 'hr' | 'cad' | 'pwr', dp: number): (number | null)[] | undefined {
  if (!points.some(p => typeof p[key] === 'number')) return undefined;
  return points.map(p => (typeof p[key] === 'number' ? r(p[key] as number, dp) : null));
}

/** Cleaned points (normalize.cleanPoints) → the stored stream. */
export function buildStream(cleaned: readonly ActivityPoint[]): ActivityStream {
  if (cleaned.length === 0) return { v: 1, s: [], d: [] };
  const allD = cumulativeDistances(cleaned);
  const idx = downsample(cleaned.map((_, i) => i), DISPLAY_POINTS);
  const pts = idx.map(i => cleaned[i]);
  const t0 = cleaned[0].t;
  const stream: ActivityStream = {
    v: 1,
    s: pts.map(p => Math.round((p.t - t0) / 1000)),
    d: idx.map(i => r(allD[i], 1)),
  };
  const lat = column(pts, 'lat', 6);
  const lng = column(pts, 'lng', 6);
  if (lat && lng) {
    stream.lat = lat;
    stream.lng = lng;
  }
  const ele = column(pts, 'ele', 1);
  if (ele) stream.ele = ele;
  const hr = column(pts, 'hr', 0);
  if (hr) stream.hr = hr;
  const cad = column(pts, 'cad', 0);
  if (cad) stream.cad = cad;
  const pwr = column(pts, 'pwr', 0);
  if (pwr) stream.pwr = pwr;
  return stream;
}

/** Every fixed [lat, lng] of a stream, in order. */
export function streamRoute(stream: ActivityStream): LatLng[] {
  const out: LatLng[] = [];
  if (!stream.lat || !stream.lng) return out;
  for (let i = 0; i < stream.lat.length; i++) {
    const la = stream.lat[i];
    const ln = stream.lng[i];
    if (la !== null && ln !== null && la !== undefined && ln !== undefined) out.push([la, ln]);
  }
  return out;
}

/**
 * The stream a viewer who is not the owner receives: every position within
 * `m` metres (along the route) of the start or the finish becomes null; a
 * route too short to keep anything loses its positions entirely. The other
 * columns (elevation, HR …) stay — a chart reveals no place.
 */
export function trimStream(stream: ActivityStream, m = TRIM_M): ActivityStream {
  const { lat, lng, ...rest } = stream;
  if (!lat || !lng) return { ...rest };
  const total = stream.d.length > 0 ? stream.d[stream.d.length - 1] : 0;
  const keep = (i: number) => stream.d[i] >= m && stream.d[i] <= total - m;
  const tLat = lat.map((v, i) => (keep(i) ? v : null));
  const tLng = lng.map((v, i) => (keep(i) ? v : null));
  if (!tLat.some(v => v !== null)) return { ...rest };
  return { ...rest, lat: tLat, lng: tLng };
}

/** The row's route_preview: the TRIMMED route, ≤ PREVIEW_POINTS, encoded. */
export function routePreview(stream: ActivityStream): string | null {
  const coords = streamRoute(trimStream(stream));
  if (coords.length < 2) return null;
  return encodePolyline(downsample(coords, PREVIEW_POINTS));
}

export type SplitUnit = 'km' | 'mi';
export const SPLIT_METRES: Readonly<Record<SplitUnit, number>> = { km: 1000, mi: 1609.344 };

/** The interpolated time (s) at a cumulative distance along the stream. */
function timeAtDistance(stream: ActivityStream, target: number): number {
  const { s, d } = stream;
  for (let i = 1; i < d.length; i++) {
    if (d[i] >= target) {
      const span = d[i] - d[i - 1];
      const f = span > 0 ? (target - d[i - 1]) / span : 0;
      return s[i - 1] + f * (s[i] - s[i - 1]);
    }
  }
  return s[s.length - 1];
}

/** The last known value of a column at or before a cumulative distance. */
function valueAtDistance(stream: ActivityStream, col: (number | null)[] | undefined, target: number): number | null {
  if (!col) return null;
  const { d } = stream;
  let best: number | null = null;
  for (let i = 0; i < d.length; i++) {
    if (col[i] !== null && col[i] !== undefined) best = col[i] as number;
    if (d[i] >= target && best !== null) return best;
  }
  return best;
}

/** Per-km (or per-mile) splits from a stream, interpolating the boundary
 *  time; the last split is the remainder (dropped when under 5% of a unit). */
export function splits(stream: ActivityStream, unit: SplitUnit): Split[] {
  const unitM = SPLIT_METRES[unit];
  const { d } = stream;
  if (d.length < 2 || d[d.length - 1] < unitM * 0.05) return [];
  const timeAt = (target: number): number => timeAtDistance(stream, target);
  const valueAt = (col: (number | null)[] | undefined, target: number): number | null => valueAtDistance(stream, col, target);
  const total = d[d.length - 1];
  const out: Split[] = [];
  let from = 0;
  let index = 1;
  while (from < total) {
    const to = Math.min(from + unitM, total);
    if (to - from < unitM * 0.05) break;
    const t0 = timeAt(from);
    const t1 = timeAt(to);
    const e0 = valueAt(stream.ele, from);
    const e1 = valueAt(stream.ele, to);
    let hrSum = 0;
    let hrN = 0;
    if (stream.hr) {
      for (let i = 0; i < d.length; i++) {
        const h = stream.hr[i];
        if (d[i] >= from && d[i] <= to && h !== null && h !== undefined) {
          hrSum += h;
          hrN += 1;
        }
      }
    }
    out.push({
      index,
      distanceM: r(to - from, 1),
      seconds: Math.max(0, Math.round(t1 - t0)),
      elevChangeM: e0 !== null && e1 !== null ? r(e1 - e0, 1) : null,
      avgHr: hrN > 0 ? Math.round(hrSum / hrN) : null,
    });
    from = to;
    index += 1;
  }
  return out;
}

// ── Segments (251): what a marked time range measures, from the stream ─────

export interface SegmentStat {
  distanceM: number;
  seconds: number;
  /** Positive elevation change inside the range (3 m hysteresis). */
  elevGainM: number | null;
  avgHr: number | null;
  /** The stream indexes the range covers — what the map and chart highlight. */
  startIndex: number;
  endIndex: number;
}

/**
 * A segment's measures from the stream it lives in — computed here, never
 * stored (a richer stream can replace the first; the numbers follow). The
 * stream's `s` is seconds from the start, like the segment's bounds. Null
 * when the range holds fewer than two samples. A viewer's TRIMMED stream
 * keeps `s` / `d` / `ele` / `hr` intact (only positions are nulled), so a
 * viewer's segment reads exactly as the athlete's.
 */
export function segmentStats(stream: ActivityStream, seg: { from_s: number; to_s: number }): SegmentStat | null {
  const { s, d } = stream;
  if (s.length < 2) return null;
  let startIndex = -1;
  let endIndex = -1;
  for (let i = 0; i < s.length; i++) {
    if (startIndex === -1 && s[i] >= seg.from_s) startIndex = i;
    if (s[i] <= seg.to_s) endIndex = i;
  }
  if (startIndex === -1 || endIndex <= startIndex) return null;
  let gain = 0;
  let sawEle = false;
  if (stream.ele) {
    let anchor: number | null = null;
    for (let i = startIndex; i <= endIndex; i++) {
      const e = stream.ele[i];
      if (e === null || e === undefined) continue;
      sawEle = true;
      if (anchor === null) {
        anchor = e;
        continue;
      }
      const delta = e - anchor;
      if (delta >= 3) {
        gain += delta;
        anchor = e;
      } else if (delta <= -3) {
        anchor = e;
      }
    }
  }
  let hrSum = 0;
  let hrN = 0;
  if (stream.hr) {
    for (let i = startIndex; i <= endIndex; i++) {
      const h = stream.hr[i];
      if (h !== null && h !== undefined) {
        hrSum += h;
        hrN += 1;
      }
    }
  }
  return {
    distanceM: r(d[endIndex] - d[startIndex], 1),
    seconds: Math.max(0, Math.round(s[endIndex] - s[startIndex])),
    elevGainM: sawEle ? r(gain, 1) : null,
    avgHr: hrN > 0 ? Math.round(hrSum / hrN) : null,
    startIndex,
    endIndex,
  };
}
