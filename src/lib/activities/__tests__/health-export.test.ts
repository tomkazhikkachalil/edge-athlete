import { describe, expect, it } from 'vitest';
import {
  MAX_WORKOUTS_PER_DELIVERY,
  adaptWorkout,
  looksLikeHealthExport,
  parseExportDate,
  parseHealthExport,
  workoutType,
} from '../adapters/health-export';
import { INBOUND_UNREADABLE, readInbound } from '../inbound-server';
import { cleanPoints, implausibility, summarize } from '../normalize';
import { exportStamp, gpxOf, healthWorkout, line, tcxOf } from './fixtures';

const START = '2026-10-01 07:00:00 -0400';
const START_MS = Date.UTC(2026, 9, 1, 11, 0, 0);
const stamp = exportStamp;
const runWorkout = (over: Record<string, unknown> = {}) => healthWorkout(START_MS, over);

describe('parseExportDate', () => {
  it('reads the export format, with the offset', () => {
    expect(parseExportDate(START)).toEqual({ t: START_MS, offsetMin: -240 });
    expect(parseExportDate('2026-10-01 11:00:00 +0000')).toEqual({ t: START_MS, offsetMin: 0 });
    expect(parseExportDate('2026-10-01T16:30:00+05:30')).toEqual({ t: START_MS, offsetMin: 330 });
    expect(parseExportDate('2026-10-01T11:00:00.500Z')).toEqual({ t: START_MS + 500, offsetMin: 0 });
  });

  it('refuses a time with no offset — a guessed zone moves the workout by hours', () => {
    expect(parseExportDate('2026-10-01 07:00:00')).toBeNull();
    expect(parseExportDate('yesterday')).toBeNull();
    expect(parseExportDate(1696150800)).toBeNull();
    expect(parseExportDate(null)).toBeNull();
  });
});

describe('workoutType', () => {
  it('maps the names Apple uses', () => {
    expect(workoutType('Outdoor Run')).toBe('run');
    expect(workoutType('Running')).toBe('run');
    expect(workoutType('Trail Running')).toBe('trail_run');
    expect(workoutType('Indoor Cycle')).toBe('ride');
    expect(workoutType('Cycling')).toBe('ride');
    expect(workoutType('Mountain Biking')).toBe('mountain_bike');
    expect(workoutType('Outdoor Walk')).toBe('walk');
    expect(workoutType('Hiking')).toBe('hike');
    expect(workoutType('Pool Swim')).toBe('swim');
    expect(workoutType('Open Water Swim')).toBe('swim');
    expect(workoutType('Rowing')).toBe('row');
    expect(workoutType('Cross Country Skiing')).toBe('ski');
    expect(workoutType('Snowboarding')).toBe('ski');
    expect(workoutType('Climbing')).toBe('climb');
  });

  it('never guesses: a name it does not know is "other"', () => {
    for (const name of ['Traditional Strength Training', 'Stair Climbing', 'Skating Sports', 'Yoga', 'High Intensity Interval Training', 'Elliptical', 'Core Training', 'Pickleball', '', 42, null]) {
      expect(workoutType(name), String(name)).toBe('other');
    }
  });
});

describe('adaptWorkout', () => {
  it('an outdoor run: the route is the timeline, the heart rate rides on it, the totals are the watch\'s', () => {
    const adapted = adaptWorkout(runWorkout());
    expect(adapted).not.toBeNull();
    const { activity, externalId } = adapted!;
    expect(externalId).toBe('5F0E3C4A-9B1D-4E2F-8A77-0C1D2E3F4A5B');
    expect(activity.format).toBeNull();
    expect(activity.type).toBe('run');
    expect(activity.name).toBeNull();
    expect(activity.tzOffsetMin).toBe(-240);
    expect(activity.device).toMatchObject({ distanceM: 5400, elapsedS: 1800, calories: 410, elevGainM: 12 });
    expect(activity.points[0].t).toBe(START_MS);
    expect(activity.points[activity.points.length - 1].t).toBe(START_MS + 1800_000);

    // It goes through the same server maths as a file.
    const cleaned = cleanPoints(activity);
    const summary = summarize(activity, cleaned);
    expect(summary.startedAt).toBe(START_MS);
    expect(summary.elapsedS).toBe(1800);
    expect(summary.hasRoute).toBe(true);
    expect(summary.distanceM).toBeGreaterThan(5300);
    expect(summary.distanceM).toBeLessThan(5500);
    expect(summary.avgHr).toBeGreaterThan(148);
    expect(summary.calories).toBe(410);
    expect(implausibility(activity, summary, START_MS + 3_600_000)).toBeNull();
  });

  it('a gym session: no route — the heart rate is the timeline and the workout bounds it', () => {
    const adapted = adaptWorkout(runWorkout({ name: 'Traditional Strength Training', route: undefined, distance: undefined, elevationUp: undefined }));
    const { activity } = adapted!;
    expect(activity.type).toBe('other');
    expect(activity.points.every(p => p.lat === undefined)).toBe(true);
    const summary = summarize(activity);
    expect(summary.elapsedS).toBe(1800);
    expect(summary.hasRoute).toBe(false);
    expect(summary.distanceM).toBeNull();
    expect(summary.avgHr).toBeGreaterThan(148);
  });

  it('a bare workout (no route, no heart rate) is still a session: start and end', () => {
    const adapted = adaptWorkout({ name: 'Yoga', start: START, end: stamp(START_MS + 2700_000), duration: 2700 });
    expect(adapted!.externalId).toBeNull();
    expect(adapted!.activity.points).toEqual([{ t: START_MS }, { t: START_MS + 2700_000 }]);
    expect(summarize(adapted!.activity).elapsedS).toBe(2700);
  });

  it('a treadmill run keeps the watch\'s distance (nothing to compute it from)', () => {
    const adapted = adaptWorkout(runWorkout({ name: 'Indoor Run', route: [], distance: { qty: 3.1, units: 'mi' } }));
    const summary = summarize(adapted!.activity);
    expect(Math.round(summary.distanceM!)).toBe(Math.round(3.1 * 1609.344));
    expect(summary.hasRoute).toBe(false);
  });

  it('reads the legacy v1 shape (lat / lon, qty heart rate, activeEnergy, no id, no duration)', () => {
    const pts = line(600, { t0: START_MS, stepM: 3 });
    const adapted = adaptWorkout({
      name: 'Running',
      start: START,
      end: stamp(START_MS + 600_000),
      activeEnergy: { qty: 500, units: 'kJ' },
      distance: { qty: 1.8, units: 'km' },
      heartRateData: [{ date: stamp(START_MS + 30_000), qty: 150, units: 'count' }],
      route: pts.map(p => ({ lat: p.lat, lon: p.lng, altitude: 90, timestamp: stamp(p.t) })),
    });
    const { activity, externalId } = adapted!;
    expect(externalId).toBeNull();
    expect(Math.round(activity.device.calories!)).toBe(120);
    const summary = summarize(activity);
    expect(summary.hasRoute).toBe(true);
    expect(summary.elapsedS).toBe(600);
    expect(summary.avgHr).toBe(150);
  });

  it('drops what it cannot trust: unknown units, samples outside the workout, a junk id', () => {
    const adapted = adaptWorkout(runWorkout({
      id: 'x y <script>',
      distance: { qty: 5.4, units: 'furlongs' },
      heartRateData: [{ date: stamp(START_MS - 3_600_000), Avg: 60 }, { date: stamp(START_MS + 60_000), Avg: 150 }],
    }));
    expect(adapted!.externalId).toBeNull();
    expect(adapted!.activity.device.distanceM).toBeUndefined();
    const hrs = adapted!.activity.points.map(p => p.hr).filter(v => v !== undefined);
    expect(hrs.every(v => v === 150)).toBe(true);
  });

  it('skips a workout it cannot place in time', () => {
    expect(adaptWorkout({ name: 'Running' })).toBeNull();
    expect(adaptWorkout({ name: 'Running', start: START })).toBeNull();
    expect(adaptWorkout({ name: 'Running', start: START, end: START })).toBeNull();
    expect(adaptWorkout({ name: 'Running', start: '2026-10-01 07:00:00', end: '2026-10-01 07:30:00' })).toBeNull();
    expect(adaptWorkout('Running')).toBeNull();
    expect(adaptWorkout(null)).toBeNull();
  });

  it('caps a very long route at the import ceiling, keeping both ends', () => {
    const pts = line(30_000, { t0: START_MS, stepM: 3 });
    const adapted = adaptWorkout({ name: 'Cycling', start: START, end: stamp(START_MS + 30_000_000), route: pts.map(p => ({ latitude: p.lat, longitude: p.lng, timestamp: stamp(p.t) })) });
    expect(adapted!.activity.points.length).toBeLessThanOrEqual(10_002);
    expect(adapted!.activity.points[0].t).toBe(START_MS);
  });
});

describe('parseHealthExport', () => {
  it('reads a delivery, counts what it skipped, and never throws', () => {
    const body = { data: { metrics: [], workouts: [runWorkout(), { name: 'broken' }, 'junk'] } };
    expect(looksLikeHealthExport(body)).toBe(true);
    const parsed = parseHealthExport(body);
    expect(parsed.activities).toHaveLength(1);
    expect(parsed.skipped).toBe(2);
  });

  it('an empty delivery is "nothing new", not an error', () => {
    expect(parseHealthExport({ data: { workouts: [] } })).toEqual({ activities: [], skipped: 0 });
  });

  it('caps a delivery', () => {
    const many = Array.from({ length: MAX_WORKOUTS_PER_DELIVERY + 5 }, (_, i) => ({ name: 'Yoga', start: stamp(START_MS + i * 3_600_000), end: stamp(START_MS + i * 3_600_000 + 600_000) }));
    const parsed = parseHealthExport({ data: { workouts: many } });
    expect(parsed.activities).toHaveLength(MAX_WORKOUTS_PER_DELIVERY);
    expect(parsed.skipped).toBe(5);
  });

  it('is not fooled by other JSON', () => {
    for (const body of [null, [], {}, { data: {} }, { data: { workouts: 'no' } }, { workouts: [] }]) {
      expect(looksLikeHealthExport(body)).toBe(false);
      expect(parseHealthExport(body)).toEqual({ activities: [], skipped: 0 });
    }
  });
});

describe('readInbound — what the upload link takes', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('the bridge app\'s JSON, whatever the Content-Type said', () => {
    const read = readInbound(bytes(JSON.stringify({ data: { workouts: [runWorkout()] } })));
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.items).toHaveLength(1);
      expect(read.items[0].externalId).toBe('5F0E3C4A-9B1D-4E2F-8A77-0C1D2E3F4A5B');
    }
  });

  it('a raw GPX and a raw TCX (with a BOM and leading space)', () => {
    const pts = line(300, { t0: START_MS, stepM: 3, hr: 150 });
    const gpx = readInbound(bytes('﻿  ' + gpxOf(pts)));
    expect(gpx.ok && gpx.items[0].activity.format).toBe('gpx');
    const tcx = readInbound(bytes(tcxOf(pts)));
    expect(tcx.ok && tcx.items[0].activity.format).toBe('tcx');
  });

  it('refuses what it does not take, in the athlete\'s words', () => {
    expect(readInbound(new Uint8Array())).toEqual({ ok: false, status: 415, error: INBOUND_UNREADABLE });
    expect(readInbound(bytes('hello'))).toEqual({ ok: false, status: 415, error: INBOUND_UNREADABLE });
    expect(readInbound(bytes('<html><body>no</body></html>'))).toEqual({ ok: false, status: 415, error: INBOUND_UNREADABLE });
    expect(readInbound(bytes('{"some":"json"}'))).toEqual({ ok: false, status: 415, error: INBOUND_UNREADABLE });
    expect(readInbound(bytes('{broken'))).toMatchObject({ ok: false, status: 422 });
    // A GPX with no timed points is the parser's own refusal.
    expect(readInbound(bytes('<gpx><trk><trkseg></trkseg></trk></gpx>'))).toMatchObject({ ok: false, status: 422 });
  });

  it('a truncated FIT is refused, never thrown', () => {
    const fake = new Uint8Array(64);
    fake.set([14, 0x20, 0, 0, 50, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54], 0);
    expect(readInbound(fake)).toMatchObject({ ok: false, status: 422 });
  });
});
