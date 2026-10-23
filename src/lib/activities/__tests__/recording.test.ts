import { describe, expect, it } from 'vitest';
import { admitFix, elapsedS, lastGapS, liveTotals, newId, MAX_ACCURACY_M, newRecording, recordsGps, reduce, requiresManualDistance, restoreRecording, GAP_ENDS_RECORDING_MS, takesManualDistance, toRecordingWire, type RecordingState, recordingAnswers, ANSWERS_DETAILS_MAX_CHARS, LENGTHS_MAX } from '../record/recording';
import { flushDue, FLUSH_EVERY_MS, FLUSH_EVERY_POINTS, isExpired, metaOf, RECORDING_TTL_MS } from '../record/storage';
import { parseWireActivity } from '../wire-schema';
import { fromWire } from '../wire';
import { cleanPoints, summarize } from '../normalize';
import { filterTrack, liveRoute } from '../gps-filter';

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
    // GPS accuracy round (Oct 9 2026): the jump is KEPT as a raw fix (the
    // recording keeps every raw fix for re-processing) and the FILTER refuses
    // it — measured against the filtered position, on the phone and the server.
    expect(s.points).toHaveLength(3);
    expect(s.points[1].acc).toBe(8);
    expect(s.rejected).toEqual({ inaccurate: 1, stale: 1, tooFast: 0 });
    expect(filterTrack(s.points, 'walk').points.some(p => (p.lat as number) > LAT0 + 400 / 111_195)).toBe(false);
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
    s = reduce(s, { type: 'photoRetried', localId: 'ph-1' }); // the tile goes back to uploading
    expect(s.photos[0]).toMatchObject({ failed: false, url: null });
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
    // The filtered route (gps-filter.ts) starts once the cold start settles
    // (the first SETTLE_FIXES fixes) and its velocity starts from rest, so it
    // reads a few metres under the true walk — never over.
    expect(t.distanceM).toBeLessThanOrEqual(dist);
    expect(dist - t.distanceM).toBeLessThan(12);
    expect(t.gpsSettling).toBe(false);
    expect(t.movingS).toBeGreaterThan(100);
    expect(t.avgPaceSPerM).toBeCloseTo(t.movingS / t.distanceM, 2);
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
    // The writer's live path: the same filter over the cleaned raw fixes.
    const summary = summarize(n, liveRoute(cleanPoints(n, { jumps: false }), n.type));
    expect(Math.abs(live.distanceM - summary.distanceM!)).toBeLessThan(2);
    expect(Math.abs(live.movingS - summary.movingS!)).toBeLessThanOrEqual(1);
  });

  // Oct 23 2026 (Tom: a space could not be typed into the name): the state keeps
  // the name AS TYPED — the set-up card's field reads it back — and the wire trims.
  it('the name is kept as typed while typing (spaces included); the wire trims; blank is none', () => {
    let s = walk(60, 1.4);
    s = reduce(s, { type: 'setName', name: 'Morning' });
    s = reduce(s, { type: 'setName', name: 'Morning ' });
    expect(s.name).toBe('Morning ');
    s = reduce(s, { type: 'setName', name: 'Morning walk ' });
    expect(s.name).toBe('Morning walk ');
    expect(toRecordingWire(reduce(s, { type: 'finish', now: T0 + 60_000 }), 'America/Toronto').name).toBe('Morning walk');
    expect(reduce(s, { type: 'setName', name: ' ' }).name).toBe(' ');
    expect(toRecordingWire(reduce(reduce(s, { type: 'setName', name: '   ' }), { type: 'finish', now: T0 + 60_000 }), 'America/Toronto').name).toBeNull();
    expect(reduce(s, { type: 'setName', name: '' }).name).toBeNull();
    expect(reduce(s, { type: 'setName', name: 'x'.repeat(130) }).name).toHaveLength(120);
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

describe('a recording restored from the device (resume pill program, Oct 12 2026)', () => {
  it('a short time away keeps it RECORDING: the clock runs on from the start, the time away is a gap', () => {
    const s = walk(60);
    const savedAt = T0 + 60_000;
    const now = savedAt + 20 * 60_000;
    const { state, gapS } = restoreRecording(s, savedAt, now);
    expect(state.status).toBe('recording');
    expect(elapsedS(state, now)).toBe(60 + 20 * 60);
    expect(state.gaps.at(-1)).toEqual({ fromMs: savedAt, toMs: now });
    expect(gapS).toBe(20 * 60);
  });
  it('the last fix counts as "last known" when it is later than the save', () => {
    const s = walk(60);
    const savedAt = T0 + 10_000;
    const now = T0 + 60_000 + 30_000;
    const { state, gapS } = restoreRecording(s, savedAt, now);
    expect(state.gaps.at(-1)).toEqual({ fromMs: T0 + 60_000, toMs: now });
    expect(gapS).toBe(30);
  });
  it('an open gap (hidden, then killed) is extended to now instead of a second one being added', () => {
    const hidden = reduce(walk(60), { type: 'hidden', now: T0 + 61_000 });
    const now = T0 + 61_000 + 5 * 60_000;
    const { state, gapS } = restoreRecording(hidden, T0 + 61_000, now);
    expect(state.gaps).toHaveLength(1);
    expect(state.gaps[0]).toEqual({ fromMs: T0 + 61_000, toMs: now });
    expect(gapS).toBe(300);
    // And a later hidden opens a NEW gap (an open one no longer blocks it).
    const again = reduce(state, { type: 'hidden', now: now + 1000 });
    expect(again.gaps).toHaveLength(2);
  });
  it('away longer than GAP_ENDS_RECORDING_MS: it comes back PAUSED where it was last known, no gap on the clock', () => {
    const s = walk(60);
    const savedAt = T0 + 60_000;
    const now = savedAt + GAP_ENDS_RECORDING_MS + 1;
    const { state, gapS } = restoreRecording(s, savedAt, now);
    expect(state.status).toBe('paused');
    expect(state.pausedAt).toBe(savedAt);
    expect(elapsedS(state, now)).toBe(60);
    expect(gapS).toBe(0);
    expect(restoreRecording(s, savedAt, savedAt + GAP_ENDS_RECORDING_MS).state.status).toBe('recording');
  });
  it('a paused or finished recording comes back as it was (an open gap closed where it was saved)', () => {
    const paused = reduce(walk(60), { type: 'pause', now: T0 + 60_000 });
    const r1 = restoreRecording(paused, T0 + 60_000, T0 + 60_000 + 3 * 3600_000);
    expect(r1.state).toBe(paused);
    expect(r1.gapS).toBe(0);
    const finished = reduce(walk(60), { type: 'finish', now: T0 + 60_000 });
    expect(restoreRecording(finished, T0 + 60_000, T0 + 90_000).state).toBe(finished);
    const stale = { ...paused, gaps: [{ fromMs: T0 + 30_000, toMs: null }] };
    expect(restoreRecording(stale, T0 + 60_000, T0 + 90_000).state.gaps[0]).toEqual({ fromMs: T0 + 30_000, toMs: T0 + 60_000 });
  });
});

describe('the recorder\'s store — the pure parts', () => {
  it('persists the state without its points, flushes on count or time, expires after the 7-day retention', () => {
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

describe('the round timer in a recording (Oct 16 2026)', () => {
  const at = (s: number) => T0 + s * 1000;
  const start = (type: 'hiit' | 'elliptical' = 'hiit') => reduce(newRecording(REC_ID, 'p1', type), { type: 'start', now: T0 });

  it('a finished Tabata leaves its 8 rounds and 7 rests as segments, at the timer’s offset', () => {
    let s = start();
    s = reduce(s, { type: 'timerStart', now: at(60), spec: { format: 'tabata', rounds: 8, workS: 20, restS: 10, warmupS: 0, cooldownS: 0 } });
    s = reduce(s, { type: 'finish', now: at(600) });
    const rounds = s.segments.filter(x => x.kind === 'round');
    expect(rounds).toHaveLength(8);
    expect(rounds[0]).toMatchObject({ from_s: 60, to_s: 80, label: 'Round 1' });
    expect(s.segments.filter(x => x.kind === 'recovery')).toHaveLength(7);
    // and the wire carries them through the server's own schema
    expect(parseWireActivity(toRecordingWire(s, 'UTC')).ok).toBe(true);
  });

  it('a pause pauses the timer: the phase reads from the recording clock', () => {
    let s = start();
    s = reduce(s, { type: 'timerStart', now: at(0), spec: { format: 'rounds', rounds: 2, workS: 60, restS: 30, warmupS: 0, cooldownS: 0 } });
    s = reduce(s, { type: 'pause', now: at(30) });
    s = reduce(s, { type: 'resume', now: at(330) });
    s = reduce(s, { type: 'finish', now: at(400) });
    // 400 s of wall clock, 100 s of recording: round 1 (0–60), rest (60–90), 10 s of round 2
    expect(s.segments.map(x => [x.kind, x.from_s, x.to_s])).toEqual([
      ['round', 0, 60],
      ['recovery', 60, 90],
      ['round', 90, 100],
    ]);
  });

  it('a stopped timer marks only what ran; AMRAP rounds are the taps', () => {
    let s = start();
    s = reduce(s, { type: 'timerStart', now: at(10), spec: { format: 'amrap', rounds: 1, workS: 600, restS: 0, warmupS: 0, cooldownS: 0 } });
    for (const t of [100, 190, 300]) s = reduce(s, { type: 'amrapTap', now: at(t) });
    s = reduce(s, { type: 'timerStop', now: at(320) });
    s = reduce(s, { type: 'amrapTap', now: at(330) }); // after Stop: ignored
    expect(s.timer!.amrapTapsS).toEqual([100, 190, 300]);
    s = reduce(s, { type: 'finish', now: at(900) });
    expect(s.segments.map(x => [x.from_s, x.to_s])).toEqual([[10, 100], [100, 190], [190, 300]]);
  });

  it('a timer cannot start before the recording does', () => {
    const idle = newRecording(REC_ID, 'p1', 'hiit');
    expect(reduce(idle, { type: 'timerStart', now: T0, spec: { format: 'tabata', rounds: 8, workS: 20, restS: 10, warmupS: 0, cooldownS: 0 } }).timer).toBeUndefined();
  });
});

describe('optional distance at finish (Oct 16 2026)', () => {
  it('elliptical, stairs and indoor ride may finish without one; swim and row may not', () => {
    expect(requiresManualDistance('elliptical')).toBe(false);
    expect(requiresManualDistance('stair_climber')).toBe(false);
    expect(requiresManualDistance('indoor_ride')).toBe(false);
    expect(requiresManualDistance('swim')).toBe(true);
    expect(requiresManualDistance('row')).toBe(true);
    expect(requiresManualDistance('run')).toBe(false);
    let s = reduce(newRecording(REC_ID, 'p1', 'elliptical'), { type: 'start', now: T0 });
    s = reduce(s, { type: 'finish', now: T0 + 1_800_000 });
    expect(parseWireActivity(toRecordingWire(s, 'UTC')).ok).toBe(true);
  });
});

describe('climbs logged while recording (A8)', () => {
  const at = (s: number) => T0 + s * 1000;
  it('logs, edits and removes climbs on the session’s scale, stamps their second, and survives the store', () => {
    let s = reduce(newRecording(REC_ID, 'p1', 'climb'), { type: 'start', now: T0 });
    s = reduce(s, { type: 'climbLogged', now: at(60), climb: { grade: 'V3', sent: true } }); // no scale yet: ignored
    expect(s.climbs ?? []).toHaveLength(0);
    s = reduce(s, { type: 'climbScale', scale: 'v' });
    s = reduce(s, { type: 'climbLogged', now: at(120), climb: { grade: 'V3', sent: true } });
    s = reduce(s, { type: 'climbLogged', now: at(300), climb: { grade: 'V5', sent: false } });
    s = reduce(s, { type: 'climbLogged', now: at(480), climb: { grade: 'V4', sent: false } });
    s = reduce(s, { type: 'climbEdited', index: 2, climb: { grade: 'V4', sent: true, attempts: 2 } });
    s = reduce(s, { type: 'climbLogged', now: at(500), climb: { grade: '5.10a', sent: true } }); // not a V grade
    expect(s.climbs).toEqual([
      { grade: 'V3', sent: true, at_s: 120 },
      { grade: 'V5', sent: false, at_s: 300 },
      { grade: 'V4', sent: true, attempts: 2, at_s: 480 },
    ]);
    s = reduce(s, { type: 'climbRemoved', index: 1 });
    expect(s.climbs!.map(c => c.grade)).toEqual(['V3', 'V4']);
    expect(metaOf(s, at(600))).toMatchObject({ climbScale: 'v', climbs: s.climbs });
  });

  it('stops at 50; a new scale keeps only what grades there', () => {
    let s = reduce(newRecording(REC_ID, 'p1', 'climb'), { type: 'start', now: T0 });
    s = reduce(s, { type: 'climbScale', scale: 'v' });
    for (let i = 0; i < 55; i++) s = reduce(s, { type: 'climbLogged', now: at(10 + i), climb: { grade: 'V1', sent: true } });
    expect(s.climbs).toHaveLength(50);
    s = reduce(s, { type: 'climbScale', scale: 'font' });
    expect(s.climbs).toEqual([]);
  });
});

describe('a sport session’s map (A9)', () => {
  it('is off by default, chosen before the start, and only for a sport session', async () => {
    const { recordsGpsFor } = await import('../record/recording');
    const idle = newRecording(REC_ID, 'p1', 'sport_session');
    expect(recordsGpsFor(idle)).toBe(false);
    const on = reduce(idle, { type: 'setMap', on: true });
    expect(recordsGpsFor(on)).toBe(true);
    const started = reduce(on, { type: 'start', now: T0 });
    expect(reduce(started, { type: 'setMap', on: false }).mapOn).toBe(true); // too late to change
    expect(reduce(newRecording(REC_ID, 'p1', 'yoga'), { type: 'setMap', on: true }).mapOn).toBeUndefined();
    expect(recordsGpsFor(newRecording(REC_ID, 'p1', 'run'))).toBe(true);
  });
});

describe('set up before Start (Program E, Oct 2026)', () => {
  const t0 = 1_700_000_000_000;
  it('answers land in ANY status, shape-checked; a climb\'s scale routes to the recording\'s own scale', () => {
    let s = newRecording('e1', 'p', 'yoga');
    s = reduce(s, { type: 'setAnswers', answers: { effort: null, notes: 'x'.repeat(3000), details: { style: 'vinyasa', heated: true } } });
    expect(s.answers).toEqual({ effort: null, notes: 'x'.repeat(2000), details: { style: 'vinyasa', heated: true } });
    s = reduce(s, { type: 'start', now: t0 });
    s = reduce(s, { type: 'setAnswers', answers: { effort: 6, notes: 'good', details: { style: 'yin' } } });
    expect(s.answers).toEqual({ effort: 6, notes: 'good', details: { style: 'yin' } });
    // Effort outside 1–10 is null; a details blob past the database's cap is refused whole.
    expect(reduce(s, { type: 'setAnswers', answers: { effort: 11, notes: '', details: {} } }).answers?.effort).toBeNull();
    const huge = { effort: null, notes: '', details: { poses: 'p'.repeat(ANSWERS_DETAILS_MAX_CHARS) } };
    expect(reduce(s, { type: 'setAnswers', answers: huge }).answers).toEqual(s.answers);
    // A climb: scale → climbScale (one owner per fact), climbs never stored in answers.
    let c = newRecording('e2', 'p', 'climb');
    c = reduce(c, { type: 'setAnswers', answers: { effort: null, notes: '', details: { setting: 'indoor', style: 'bouldering', scale: 'v', climbs: [{ grade: 'V3', sent: true }] } } });
    expect(c.climbScale).toBe('v');
    expect(c.answers).toEqual({ effort: null, notes: '', details: { setting: 'indoor', style: 'bouldering' } });
    expect(recordingAnswers(c).details).toEqual({ setting: 'indoor', style: 'bouldering', scale: 'v' });
    c = reduce(c, { type: 'start', now: t0 });
    c = reduce(c, { type: 'climbLogged', now: t0 + 60_000, climb: { grade: 'V3', sent: true } });
    expect(recordingAnswers(c).details.climbs).toHaveLength(1);
  });
  it('prefill lands once and fills only what is unset', () => {
    let s = newRecording('e3', 'p', 'yoga');
    s = reduce(s, { type: 'setAnswers', answers: { effort: null, notes: '', details: { style: 'yin' } } });
    s = reduce(s, { type: 'prefill', details: { style: 'vinyasa', guided: 'class' } });
    expect(s.prefilled).toBe(true);
    expect(s.answers?.details).toEqual({ style: 'yin', guided: 'class' });
    expect(reduce(s, { type: 'prefill', details: { heated: true } }).answers?.details).toEqual({ style: 'yin', guided: 'class' });
    // An old meta without the new fields reduces as before.
    const old = newRecording('e4', 'p', 'run');
    expect(recordingAnswers(old)).toEqual({ effort: null, notes: '', details: {} });
    expect(reduce(old, { type: 'start', now: t0 }).timer).toBeUndefined();
  });
  it('a timer armed before Start runs from the first second; arming is idle-only; timerStart keeps its rule', () => {
    let s = newRecording('e5', 'p', 'hiit');
    s = reduce(s, { type: 'timerSet', spec: { format: 'tabata', rounds: 8, workS: 20, restS: 10, warmupS: 0, cooldownS: 0 } });
    expect(s.timerArmed?.format).toBe('tabata');
    s = reduce(s, { type: 'timerSet', spec: null });
    expect(s.timerArmed).toBeNull();
    s = reduce(s, { type: 'timerSet', spec: { format: 'tabata', rounds: 8, workS: 20, restS: 10, warmupS: 0, cooldownS: 0 } });
    s = reduce(s, { type: 'start', now: t0 });
    expect(s.timer).toMatchObject({ startS: 0, stopS: null, amrapTapsS: [] });
    expect(s.timer?.spec.format).toBe('tabata');
    expect(s.timerArmed).toBeNull();
    expect(reduce(s, { type: 'timerSet', spec: null })).toBe(s);
  });
  it('a pool swim counts lengths while recording; the live distance is lengths × the pool', () => {
    let s = newRecording('e6', 'p', 'swim');
    expect(reduce(s, { type: 'lengthsSet', lengths: 4 })).toBe(s); // not before Start
    s = reduce(s, { type: 'setAnswers', answers: { effort: null, notes: '', details: { pool: '25m' } } });
    s = reduce(s, { type: 'start', now: t0 });
    s = reduce(s, { type: 'lengthsSet', lengths: 4 });
    expect(s.lengths).toBe(4);
    expect(reduce(s, { type: 'lengthsSet', lengths: LENGTHS_MAX + 1 }).lengths).toBe(4);
    const live = liveTotals(s, t0 + 120_000, null);
    expect(live.distanceM).toBe(100);
    expect(live.movingS).toBe(120);
    expect(reduce(newRecording('e7', 'p', 'run'), { type: 'lengthsSet', lengths: 1 }).lengths).toBeUndefined();
  });
  it('the descent is counted live, symmetric to the gain', () => {
    // A 1 Hz track at a steady 1.4 m/s (the filter admits it): up 30 m over two
    // minutes, then down 30 m over the next two.
    let s = newRecording('e8', 'p', 'ski');
    s = reduce(s, { type: 'start', now: t0 });
    for (let n = 1; n <= 240; n++) {
      const ele = n <= 120 ? 1000 + n * 0.25 : 1030 - (n - 120) * 0.25;
      s = reduce(s, { type: 'fix', fix: { t: t0 + n * 1000, lat: 45 + (n * 1.4) / 111_195, lng: -75, ele, accuracy: 8 } });
    }
    // The filter settles over the first fixes (gps-filter.ts), so the exact
    // metres depend on it; what this pins is the SYMMETRY — the descent is
    // counted the way the gain always was.
    const live = liveTotals(s, t0 + 240_000, null);
    expect(live.elevGainM).toBeGreaterThanOrEqual(15);
    expect(live.elevLossM).toBeGreaterThanOrEqual(15);
    expect(Math.abs((live.elevGainM ?? 0) - (live.elevLossM ?? 0))).toBeLessThanOrEqual(5);
  });
});
