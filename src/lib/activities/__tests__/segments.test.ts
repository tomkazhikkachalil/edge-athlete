import { describe, expect, it } from 'vitest';
import { normalizeSegments, parseSegments, SEGMENT_MAX, SEGMENT_MIN_S, segmentsFromRow } from '../segments';
import { estimateSteps, strideM, STEP_RUN_SPEED_MPS } from '../normalize';
import { buildStream, segmentStats, splits } from '../stream';
import { ACTIVITY_TYPES, ACTIVITY_TYPE_DEFS, activityTypesInGroup, STEP_TYPES } from '../catalog';
import { line } from './fixtures';

describe('segments — boundaries only, the shape the DB CHECK cannot say', () => {
  it('parses a good list and refuses the shapes that are not segments', () => {
    expect(parseSegments([{ id: 'a', kind: 'sprint', from_s: 10, to_s: 40 }])).toMatchObject({ ok: true });
    expect(parseSegments([{ id: 'a', kind: 'sprint', from_s: 10, to_s: 12 }])).toMatchObject({ ok: false }); // shorter than SEGMENT_MIN_S
    expect(parseSegments([{ id: 'a', kind: 'dash', from_s: 10, to_s: 40 }])).toMatchObject({ ok: false });
    expect(parseSegments([{ id: 'a', kind: 'sprint', from_s: 10, to_s: 40, extra: 1 }])).toMatchObject({ ok: false });
    expect(parseSegments(new Array(SEGMENT_MAX + 1).fill({ id: 'a', kind: 'lap', from_s: 0, to_s: 10 }))).toMatchObject({ ok: false });
    expect(parseSegments('nope')).toMatchObject({ ok: false });
    expect(segmentsFromRow(null)).toEqual([]);
    expect(segmentsFromRow([{ id: 'a', kind: 'climb', from_s: 0, to_s: 60, label: 'Hill' }])).toHaveLength(1);
  });

  it('normalizes: clamps to the elapsed seconds, drops the empties, sorts, dedupes ids, is idempotent', () => {
    const out = normalizeSegments(
      [
        { id: 'late', kind: 'lap', from_s: 500, to_s: 700 },
        { id: 'b', kind: 'sprint', from_s: 100, to_s: 130 },
        { id: 'a', kind: 'climb', from_s: 20, to_s: 90, label: '  Hill  ' },
        { id: 'a', kind: 'climb', from_s: 0, to_s: 90 },
        { id: 'tiny', kind: 'interval', from_s: 598, to_s: 650 },
      ],
      600
    );
    expect(out.map(s => s.id)).toEqual(['a', 'b', 'late']);
    expect(out[2]).toEqual({ id: 'late', kind: 'lap', from_s: 500, to_s: 600 });
    expect(out[0].label).toBe('Hill');
    expect(normalizeSegments(out, 600)).toEqual(out);
    expect(SEGMENT_MIN_S).toBe(5);
  });
});

describe('steps — an estimate from distance and stride, labelled "est."', () => {
  it('uses the height when known and the pace to pick the stride', () => {
    expect(strideM(false, 180)).toBeCloseTo(0.7434, 3);
    expect(strideM(true, 180)).toBeCloseTo(1.17, 3);
    expect(strideM(false, null)).toBe(0.75);
    expect(strideM(true, 20)).toBe(1.0); // an implausible height falls back
    // 5 km walked in an hour → walking stride.
    expect(estimateSteps('walk', 5000, 3600, 180)).toBe(Math.round(5000 / 0.7434));
    // 5 km run in 25 min (3.3 m/s ≥ the run threshold) → running stride.
    expect(estimateSteps('run', 5000, 1500, 180)).toBe(Math.round(5000 / 1.17));
    expect(STEP_RUN_SPEED_MPS).toBe(2);
    // A treadmill is either — the pace decides.
    expect(estimateSteps('treadmill', 3000, 3000, null)).toBe(4000);
    expect(estimateSteps('treadmill', 3000, 1000, null)).toBe(3000);
  });
  it('is null for a type that is not stepped, and for no distance', () => {
    expect(estimateSteps('ride', 20000, 3600, 180)).toBeNull();
    expect(estimateSteps('swim', 1000, 1200, 180)).toBeNull();
    expect(estimateSteps('walk', null, 3600, 180)).toBeNull();
    expect(estimateSteps('walk', 0, 3600, 180)).toBeNull();
    for (const t of STEP_TYPES) expect(ACTIVITY_TYPE_DEFS[t]).toBeTruthy();
  });
});

describe('segmentStats — a marked time range measured from the stream', () => {
  it('agrees with splits() on a whole kilometre', () => {
    // 2 km at 5 m every 2 s (2.5 m/s), climbing 1 m every 10 samples.
    const pts = line(401, { stepM: 5, stepS: 2 }).map((p, i) => ({ ...p, ele: 100 + Math.floor(i / 10) }));
    const stream = buildStream(pts);
    const [first] = splits(stream, 'km');
    const seg = segmentStats(stream, { from_s: 0, to_s: first.seconds });
    expect(seg).not.toBeNull();
    expect(Math.abs(seg!.distanceM - 1000)).toBeLessThan(6);
    expect(seg!.seconds).toBe(first.seconds);
    expect(seg!.elevGainM).toBeGreaterThan(15);
    expect(seg!.startIndex).toBe(0);
    expect(seg!.endIndex).toBeGreaterThan(seg!.startIndex);
  });
  it('is null for a range holding fewer than two samples', () => {
    const stream = buildStream(line(20, { stepM: 5, stepS: 2 }));
    expect(segmentStats(stream, { from_s: 100, to_s: 200 })).toBeNull();
    expect(segmentStats({ v: 1, s: [], d: [] }, { from_s: 0, to_s: 10 })).toBeNull();
  });
});

describe('the broad, grouped catalog (Tom, Oct 4 2026)', () => {
  it('has 26 types in three groups, each with a recording mode', () => {
    expect(ACTIVITY_TYPES).toHaveLength(26);
    const groups = { outdoor: activityTypesInGroup('outdoor'), indoor: activityTypesInGroup('indoor'), duration: activityTypesInGroup('duration') };
    expect(groups.outdoor.length + groups.indoor.length + groups.duration.length).toBe(26);
    for (const t of groups.outdoor) expect(ACTIVITY_TYPE_DEFS[t].recording).toBe('gps');
    for (const t of groups.indoor) expect(ACTIVITY_TYPE_DEFS[t].recording).toBe('timer');
    for (const t of groups.duration) expect(ACTIVITY_TYPE_DEFS[t].recording).toBe('duration');
    // 245's eleven are all still here.
    for (const t of ['run', 'trail_run', 'walk', 'hike', 'ride', 'mountain_bike', 'swim', 'row', 'ski', 'climb', 'other']) expect(ACTIVITY_TYPES).toContain(t);
  });
});
