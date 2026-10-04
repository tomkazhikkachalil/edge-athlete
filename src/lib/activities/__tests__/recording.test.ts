import { describe, expect, it } from 'vitest';
import {
  admitFix,
  elapsedS,
  lastGapS,
  liveTotals,
  newId,
  MAX_ACCURACY_M,
  newRecording,
  recordsGps,
  reduce,
  takesManualDistance,
  toRecordingWire,
  type RecordingState,
} from '../record/recording';
import { flushDue, FLUSH_EVERY_MS, FLUSH_EVERY_POINTS, isExpired, metaOf, RECORDING_TTL_MS } from '../record/storage';
import { parseWireActivity } from '../wire-schema';
import { fromWire } from '../wire';
import { cleanPoints, summarize } from '../normalize';

const T0 = Date.UTC(2026, 9, 4, 14, 0, 0);
const REC_ID = '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f40';
const REC_ID_2 = '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f41';
const LAT0 = 43.65;
const LNG0 = -79.38;
/** A fix `n` seconds in, `m` metres north of the start. */
const fixAt = (n: number, m: number, accuracy = 8) => ({ t: T0 + n * 1000, lat: LAT0 + m / 111_195, lng: LNG0, ele: 100, accuracy });

function walk(seconds: number, mps = 1.4): RecordingState {
  let s = reduce(newRecording(REC_ID, 'p1', 'walk'), { type: 'start', now: T0 });
  for (let n = 1; n <= seconds; n++) s = reduce(s, { type: 'fix', fix: fixAt(n, n * mps) });
  return s;
}

describe('the recorder — a pure state machine', () => {
  it('starts once, admits fixes while recording only, and counts what it refuses', () => {
    const idle = newRecording(REC_ID, 'p1', 'walk');
    expect(reduce(idle, { type: 'fix', fix: fixAt(1, 1) }).points).toHaveLength(0);
    let s = reduce(idle, { type: 'start', now: T0 });
    expect(reduce(s, { type: 'start', now: T0 + 5000 })).toBe(s); // a second start changes nothing
    s = reduce(s, { type: 'fix', fix: fixAt(1, 1.4) });
    s = reduce(s, { type: 'fix', fix: fixAt(2, 2.8, MAX_ACCURACY_M + 1) }); // too imprecise
    s = reduce(s, { type: 'fix', fix: fixAt(1, 1.4) }); // out of order
    s = reduce(s, { type: 'fix', fix: fixAt(3, 500) }); // a 250 m/s hop on a walk — a GPS jump
    s = reduce(s, { type: 'fix', fix: fixAt(4, 5.6) });
    expect(s.points).toHaveLength(2);
    expect(s.rejected).toEqual({ inaccurate: 1, stale: 1, tooFast: 1 });
    expect(admitFix(s, fixAt(5, 7))).toBe('ok');
  });

  it('a pause admits nothing and leaves the elapsed clock; a resume adds the pause to the total', () => {
    let s = walk(60);
    s = reduce(s, { type: 'pause', now: T0 + 60_000 });
    expect(s.status).toBe('paused');
    s = reduce(s, { type: 'fix', fix: fixAt(70, 100) });
    expect(s.points).toHaveLength(60);
    expect(elapsedS(s, T0 + 90_000)).toBe(60); // the clock stands still while paused
    s = reduce(s, { type: 'resume', now: T0 + 120_000 });
    expect(s.pausedTotalMs).toBe(60_000);
    expect(elapsedS(s, T0 + 130_000)).toBe(70);
  });

  it('Mark opens a segment, the second tap closes it with a kind; a mis-tap is not a segment; a pause ends an open one', () => {
    let s = walk(30);
    s = reduce(s, { type: 'markStart', now: T0 + 30_000 });
    expect(s.openSegmentFromS).toBe(30);
    expect(reduce(s, { type: 'markStart', now: T0 + 31_000 }).openSegmentFromS).toBe(30); // one open at a time
    s = reduce(s, { type: 'markEnd', now: T0 + 50_000, kind: 'sprint', label: ' Hill ', id: 'seg-1' });
    expect(s.segments).toEqual([{ id: 'seg-1', kind: 'sprint', from_s: 30, to_s: 50, label: 'Hill' }]);
    s = reduce(s, { type: 'markStart', now: T0 + 51_000 });
    s = reduce(s, { type: 'markEnd', now: T0 + 53_000, kind: 'lap', id: 'seg-2' }); // 2 s — a mis-tap
    expect(s.segments).toHaveLength(1);
    s = reduce(s, { type: 'markStart', now: T0 + 60_000 });
    s = reduce(s, { type: 'pause', now: T0 + 80_000 });
    expect(s.openSegmentFromS).toBeNull();
    expect(s.segments[1]).toMatchObject({ kind: 'interval', from_s: 60, to_s: 80 });
    expect(reduce(s, { type: 'markStart', now: T0 + 81_000 }).openSegmentFromS).toBeNull(); // not while paused
  });

  it('photos are tiles with the moment they were taken; a hidden page is a gap shown on return', () => {
    let s = walk(20);
    s = reduce(s, { type: 'photoAdded', localId: 'ph-1', mediaType: 'image', now: T0 + 20_000 });
    expect(s.photos[0]).toMatchObject({ localId: 'ph-1', atS: 20, url: null, failed: false });
    s = reduce(s, { type: 'photoFailed', localId: 'ph-1' });
    expect(s.photos[0].failed).toBe(true);
    s = reduce(s, { type: 'photoUploaded', localId: 'ph-1', url: 'https://x/a.jpg' });
    expect(s.photos[0]).toMatchObject({ url: 'https://x/a.jpg', failed: false });
    s = reduce(s, { type: 'hidden', now: T0 + 30_000 });
    s = reduce(s, { type: 'hidden', now: T0 + 31_000 }); // one open gap at a time
    expect(s.gaps).toHaveLength(1);
    s = reduce(s, { type: 'visible', now: T0 + 75_000 });
    expect(lastGapS(s)).toBe(45);
    s = reduce(s, { type: 'photoRemoved', localId: 'ph-1' });
    expect(s.photos).toHaveLength(0);
  });

  it('live totals: distance, moving time, current and average pace, an estimated step count', () => {
    const s = walk(120, 1.4); // 119 hops of 1.4 m in 2 min (the first fix is the start)
    const dist = 119 * 1.4;
    const t = liveTotals(s, T0 + 120_000, 180);
    expect(t.elapsedS).toBe(120);
    expect(Math.abs(t.distanceM - dist)).toBeLessThan(1);
    expect(t.movingS).toBe(119);
    expect(t.avgPaceSPerM).toBeCloseTo(119 / dist, 2);
    expect(t.currentPaceSPerM).toBeCloseTo(1 / 1.4, 1);
    expect(t.steps).toBe(Math.round(t.distanceM / (1.8 * 0.413)));
    expect(t.lastFixAgeS).toBe(0);
    // Standing still: no current pace.
    let still = walk(10);
    for (let n = 11; n <= 40; n++) still = reduce(still, { type: 'fix', fix: fixAt(n, 14) });
    expect(liveTotals(still, T0 + 40_000, null).currentPaceSPerM).toBeNull();
  });

  it('the live totals agree with the server summary on the same points', () => {
    const s = walk(300, 1.5);
    const live = liveTotals(s, T0 + 300_000, null);
    const n = fromWire({ ...toRecordingWire(reduce(s, { type: 'finish', now: T0 + 300_000 }), 'UTC') });
    const summary = summarize(n, cleanPoints(n));
    expect(Math.abs(live.distanceM - summary.distanceM!)).toBeLessThan(2);
    expect(Math.abs(live.movingS - summary.movingS!)).toBeLessThanOrEqual(1);
  });

  it('finish closes the open segment and the open gap, and the wire is what the server accepts', () => {
    let s = walk(600, 1.4);
    s = reduce(s, { type: 'markStart', now: T0 + 100_000 });
    s = reduce(s, { type: 'hidden', now: T0 + 590_000 });
    s = reduce(s, { type: 'setName', name: '  Lunch walk ' });
    s = reduce(s, { type: 'finish', now: T0 + 600_000 });
    expect(s.status).toBe('finished');
    expect(s.segments).toEqual([{ id: expect.any(String), kind: 'interval', from_s: 100, to_s: 600 }]);
    expect(s.gaps[0].toMs).toBe(T0 + 600_000);
    const wire = toRecordingWire(s, 'America/Toronto');
    expect(wire).toMatchObject({ v: 1, format: 'live', type: 'walk', name: 'Lunch walk', recordingId: REC_ID });
    expect(wire.segments).toHaveLength(1);
    const parsed = parseWireActivity(wire);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    expect(reduce(s, { type: 'fix', fix: fixAt(601, 1000) })).toBe(s); // finished admits nothing
    expect(() => toRecordingWire(walk(5), 'UTC')).toThrow();
  });

  it('a timer type sends two bookend samples and the typed distance as the device total', () => {
    expect(recordsGps('walk')).toBe(true);
    expect(recordsGps('swim')).toBe(false);
    expect(takesManualDistance('swim')).toBe(true);
    expect(takesManualDistance('yoga')).toBe(false);
    let s = reduce(newRecording(REC_ID_2, 'p1', 'swim'), { type: 'start', now: T0 });
    s = reduce(s, { type: 'setManualDistance', distanceM: 1500 });
    s = reduce(s, { type: 'finish', now: T0 + 1800_000 });
    const wire = toRecordingWire(s, 'UTC');
    expect(wire.dt).toEqual([0, 1800_000]);
    expect(wire.device).toMatchObject({ distanceM: 1500, elapsedS: 1800, movingS: 1800 });
    expect(wire.lat).toBeUndefined();
    const parsed = parseWireActivity(wire);
    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    const summary = summarize(fromWire(wire));
    expect(summary.distanceM).toBe(1500);
    expect(summary.elapsedS).toBe(1800);
    expect(liveTotals(s, T0 + 1800_000, null).distanceM).toBe(1500);
  });
});

describe('the recorder\'s store — the pure parts', () => {
  it('persists the state without its points, flushes on count or time, expires after 48 h', () => {
    const s = walk(25);
    const meta = metaOf(s, T0 + 25_000);
    expect(meta.pointCount).toBe(25);
    expect('points' in meta).toBe(false);
    expect(flushDue(FLUSH_EVERY_POINTS, T0, T0 + 1000)).toBe(true);
    expect(flushDue(1, T0, T0 + FLUSH_EVERY_MS)).toBe(true);
    expect(flushDue(1, T0, T0 + 1000)).toBe(false);
    expect(flushDue(0, T0, T0 + FLUSH_EVERY_MS * 3)).toBe(false);
    expect(isExpired(meta, T0 + 25_000 + RECORDING_TTL_MS)).toBe(false);
    expect(isExpired(meta, T0 + 25_000 + RECORDING_TTL_MS + 1)).toBe(true);
  });
});

describe('newId — a v4 uuid on every browser the app supports', () => {
  it('is a uuid with the version and variant bits, and never repeats in a burst', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
