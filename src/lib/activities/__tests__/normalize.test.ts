import { describe, expect, it } from 'vitest';
import { cleanPoints, cumulativeDistances, downsample, fileExternalId, haversineM, implausibility, occurredOn, summarize } from '../normalize';
import { buildStream, routePreview, splits, streamRoute, trimStream, TRIM_M } from '../stream';
import { decodePolyline, encodePolyline } from '../polyline';
import { fromWire, toWire } from '../wire';
import { parseWireActivity } from '../wire-schema';
import { parseGpx } from '../parse-gpx';
import type { NormalizedActivity } from '../types';
import { gpxOf, line } from './fixtures';

const act = (points: NormalizedActivity['points'], over: Partial<NormalizedActivity> = {}): NormalizedActivity => ({
  format: 'gpx',
  type: 'run',
  name: null,
  points,
  device: {},
  tzOffsetMin: null,
  ...over,
});

describe('haversineM', () => {
  it('measures a degree of latitude as ~111.2 km', () => {
    expect(haversineM(0, 0, 1, 0)).toBeGreaterThan(111_100);
    expect(haversineM(0, 0, 1, 0)).toBeLessThan(111_300);
  });
});

describe('cleanPoints', () => {
  it('sorts, drops duplicate timestamps and out-of-range sensor values', () => {
    const t = Date.UTC(2026, 0, 1);
    const out = cleanPoints(act([
      { t: t + 2000, lat: 1, lng: 1, hr: 300 },
      { t, lat: 1, lng: 1, hr: 120 },
      { t, lat: 5, lng: 5 },
      { t: t + 1000, lat: 1, lng: 1, ele: 99_999, pwr: -5 },
    ]));
    expect(out.map(p => p.t)).toEqual([t, t + 1000, t + 2000]);
    expect(out[0].hr).toBe(120);
    expect(out[1].ele).toBeUndefined();
    expect(out[1].pwr).toBeUndefined();
    expect(out[2].hr).toBeUndefined();
  });

  it('drops the FIX of a GPS jump but keeps the sample', () => {
    const pts = line(5);
    pts[2] = { ...pts[2], lat: pts[2].lat + 1 }; // 111 km in a second
    const out = cleanPoints(act(pts));
    expect(out).toHaveLength(5);
    expect(out[2].lat).toBeUndefined();
    expect(out[3].lat).toBeDefined();
  });
});

describe('downsample', () => {
  it('keeps both ends and at most max items', () => {
    const xs = Array.from({ length: 1001 }, (_, i) => i);
    const d = downsample(xs, 10);
    expect(d).toHaveLength(10);
    expect(d[0]).toBe(0);
    expect(d[9]).toBe(1000);
    expect(downsample([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });
});

describe('summarize', () => {
  it('totals a 1 km run at 3 m/s from the points', () => {
    const s = summarize(act(line(335, { stepM: 3, stepS: 1, hr: 150, climbPerStep: 0.1 })));
    expect(s.elapsedS).toBe(334);
    expect(s.distanceM).toBeGreaterThan(995);
    expect(s.distanceM).toBeLessThan(1010);
    expect(s.movingS).toBe(334);
    expect(s.elevGainM).toBeGreaterThan(30);
    expect(s.elevLossM).toBe(0);
    expect(s.avgHr).toBe(152);
    expect(s.maxHr).toBe(154);
    expect(s.hasRoute).toBe(true);
  });

  it('keeps a plausible device distance, refuses an implausible one', () => {
    const pts = line(335);
    expect(summarize(act(pts, { device: { distanceM: 1050 } })).distanceM).toBe(1050);
    expect(summarize(act(pts, { device: { distanceM: 5000 } })).distanceM).toBeLessThan(1010);
  });

  it('uses the device counter for an indoor activity (no fixes)', () => {
    const t = Date.UTC(2026, 0, 1);
    const pts = Array.from({ length: 61 }, (_, i) => ({ t: t + i * 1000, dist: i * 5 }));
    const s = summarize(act(pts, { type: 'ride' }));
    expect(s.distanceM).toBe(300);
    expect(s.hasRoute).toBe(false);
    expect(s.movingS).toBe(60);
  });

  it('counts a long gap as a pause, never moving time', () => {
    const pts = [...line(10), ...line(10, { t0: Date.UTC(2026, 8, 20, 12, 10, 0), lat0: 43.65 + 27 / 111_195 })];
    const s = summarize(act(pts));
    expect(s.elapsedS).toBeGreaterThan(600);
    expect(s.movingS).toBeLessThan(30);
  });
});

describe('implausibility', () => {
  const now = Date.UTC(2026, 8, 29);
  it('accepts a normal run', () => {
    const a = act(line(335));
    expect(implausibility(a, summarize(a), now)).toBeNull();
  });
  it('refuses a "run" at car speed with a message naming the fix', () => {
    const a = act(line(100, { stepM: 25 }));
    expect(implausibility(a, summarize(a), now)).toMatch(/faster than a run/);
    const ride = act(line(100, { stepM: 25 }), { type: 'ride' });
    expect(implausibility(ride, summarize(ride), now)).toBeNull();
  });
  it('refuses a single moment, a >48 h file and a future date', () => {
    const one = act(line(1));
    expect(implausibility(one, summarize(one), now)).toMatch(/one moment/);
    const long = act(line(2, { stepS: 200_000 }));
    expect(implausibility(long, summarize(long), now)).toMatch(/48 hours/);
    const future = act(line(5, { t0: now + 5 * 86_400_000 }));
    expect(implausibility(future, summarize(future), now)).toMatch(/date/);
  });
});

describe('occurredOn', () => {
  const lateEvening = Date.UTC(2026, 8, 21, 1, 30); // 21:30 on the 20th in Toronto
  it('uses the file offset first, then the uploader zone, then UTC', () => {
    expect(occurredOn(lateEvening, -240, 'Asia/Tokyo')).toBe('2026-09-20');
    expect(occurredOn(lateEvening, null, 'America/Toronto')).toBe('2026-09-20');
    expect(occurredOn(lateEvening, null, null)).toBe('2026-09-21');
    expect(occurredOn(lateEvening, null, 'Not/AZone')).toBe('2026-09-21');
  });
});

describe('fileExternalId', () => {
  it('is the start second, so the same run as .FIT and .GPX is one activity', () => {
    expect(fileExternalId(1_758_000_000_123)).toBe('start:1758000000');
  });
});

describe('the stream', () => {
  const pts = cleanPoints(act(line(3000, { stepM: 1, hr: 140, climbPerStep: 0.01 })));
  const stream = buildStream(pts);

  it('is columnar, ≤ 2,000 samples, aligned, rounded', () => {
    expect(stream.s).toHaveLength(2000);
    expect(stream.d).toHaveLength(2000);
    expect(stream.lat).toHaveLength(2000);
    expect(stream.hr).toHaveLength(2000);
    expect(stream.cad).toBeUndefined();
    expect(stream.s[0]).toBe(0);
    expect(stream.s[1999]).toBe(2999);
    expect(stream.d[1999]).toBeCloseTo(cumulativeDistances(pts)[2999], 0);
  });

  it(`trims the first and last ${TRIM_M} m of positions, keeping every other column`, () => {
    const t = trimStream(stream);
    const total = stream.d[stream.d.length - 1];
    for (let i = 0; i < t.d.length; i++) {
      if (t.lat![i] !== null) {
        expect(t.d[i]).toBeGreaterThanOrEqual(TRIM_M);
        expect(t.d[i]).toBeLessThanOrEqual(total - TRIM_M);
      }
    }
    expect(t.lat![0]).toBeNull();
    expect(t.lat![t.lat!.length - 1]).toBeNull();
    expect(t.hr).toEqual(stream.hr);
    expect(streamRoute(t).length).toBeGreaterThan(1000);
  });

  it('drops positions entirely on a route shorter than the two trims', () => {
    const short = buildStream(cleanPoints(act(line(100, { stepM: 3 }))));
    const t = trimStream(short);
    expect(t.lat).toBeUndefined();
    expect(t.lng).toBeUndefined();
    expect(routePreview(short)).toBeNull();
  });

  it('builds a preview from the TRIMMED route, ≤ 200 points', () => {
    const preview = routePreview(stream)!;
    const coords = decodePolyline(preview);
    expect(coords.length).toBeLessThanOrEqual(200);
    const start = streamRoute(stream)[0];
    // The preview's first point is ≥ 200 m from the real start.
    expect(haversineM(start[0], start[1], coords[0][0], coords[0][1])).toBeGreaterThan(TRIM_M - 5);
  });

  it('splits by km and by mile, the remainder last', () => {
    const km = splits(stream, 'km');
    expect(km).toHaveLength(3);
    expect(km[0].distanceM).toBe(1000);
    expect(km[0].seconds).toBeGreaterThan(990);
    expect(km[0].seconds).toBeLessThan(1010);
    expect(km[0].avgHr).toBeGreaterThanOrEqual(140);
    expect(km[0].elevChangeM).toBeCloseTo(10, 0);
    expect(splits(stream, 'mi')).toHaveLength(2);
  });
});

describe('polyline', () => {
  it('round-trips within precision 5', () => {
    const coords: [number, number][] = [[43.65, -79.38], [43.651, -79.3812], [-33.8688, 151.2093]];
    const back = decodePolyline(encodePolyline(coords));
    back.forEach((c, i) => {
      expect(c[0]).toBeCloseTo(coords[i][0], 5);
      expect(c[1]).toBeCloseTo(coords[i][1], 5);
    });
  });
  it('never throws on garbage', () => {
    expect(() => decodePolyline('\u0000ÿ}}}')).not.toThrow();
  });
});

describe('the wire payload', () => {
  it('round-trips a parsed GPX and passes the server schema', () => {
    const parsed = parseGpx(gpxOf(line(50, { hr: 140 })));
    const w = toWire({ ...parsed, format: 'gpx' }, 'America/Toronto');
    const r = parseWireActivity(JSON.parse(JSON.stringify(w)));
    expect(r.ok).toBe(true);
    const back = fromWire(w);
    expect(back.points).toHaveLength(50);
    expect(back.points[10].hr).toBe(parsed.points[10].hr);
    expect(back.points[10].lat).toBeCloseTo(parsed.points[10].lat!, 6);
  });

  it('refuses misaligned columns, a lone lat, too many samples and extra keys', () => {
    const w = toWire({ ...parseGpx(gpxOf(line(5))), format: 'gpx' }, null);
    expect(parseWireActivity({ ...w, hr: [1, 2] }).ok).toBe(false);
    const { lng: _drop, ...lone } = w;
    void _drop;
    expect(parseWireActivity(lone).ok).toBe(false);
    expect(parseWireActivity({ ...w, dt: Array.from({ length: 10_001 }, (_, i) => i) }).ok).toBe(false);
    expect(parseWireActivity({ ...w, distanceM: 5 }).ok).toBe(false);
  });
});
