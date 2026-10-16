import { describe, expect, it } from 'vitest';
import { boundaryCrossed, normalizeSpec, phaseAt, phaseLine, schedule, timerSegments, totalS, TIMER_PRESETS, type TimerSpec } from '../record/round-timer';

const tabata = normalizeSpec({ format: 'tabata' });

describe('schedules', () => {
  it('Tabata is 8 × 20/10 = 4:00 with no rest after the last round', () => {
    const s = schedule(tabata);
    expect(s.filter(p => p.kind === 'work')).toHaveLength(8);
    expect(s.filter(p => p.kind === 'rest')).toHaveLength(7);
    expect(totalS(tabata)).toBe(8 * 20 + 7 * 10);
    // the format's own rules: Tabata ignores what it is given
    expect(normalizeSpec({ format: 'tabata', rounds: 3, workS: 99 })).toEqual(tabata);
  });

  it('EMOM 10 rings every minute and runs its last minute in full', () => {
    const e = normalizeSpec({ format: 'emom', rounds: 10, workS: 60 });
    expect(totalS(e)).toBe(600);
    let bells = 0;
    for (let t = 1; t <= 600; t++) bells += boundaryCrossed(schedule(e), t - 1, t);
    expect(bells).toBe(10); // minutes 2–10 start + the end
    const window = normalizeSpec({ format: 'emom', rounds: 2, workS: 40 });
    expect(window.restS).toBe(20);
    expect(totalS(window)).toBe(120);
  });

  it('AMRAP is one countdown with no rest', () => {
    const a = normalizeSpec({ format: 'amrap', workS: 720, rounds: 5, restS: 30 });
    expect(a).toMatchObject({ rounds: 1, restS: 0, workS: 720 });
    expect(schedule(a)).toEqual([{ kind: 'work', round: 1, fromS: 0, toS: 720 }]);
  });

  it('Intervals keep a warm-up and cool-down; Rounds do not', () => {
    const i = normalizeSpec({ format: 'intervals', rounds: 2, workS: 60, restS: 30, warmupS: 120, cooldownS: 60 });
    expect(schedule(i).map(p => p.kind)).toEqual(['warmup', 'work', 'rest', 'work', 'cooldown']);
    expect(totalS(i)).toBe(120 + 60 + 30 + 60 + 60);
    expect(normalizeSpec({ format: 'rounds', rounds: 3, workS: 180, restS: 60, warmupS: 120 }).warmupS).toBe(0);
  });

  it('every preset is already normal', () => {
    for (const list of Object.values(TIMER_PRESETS)) for (const p of list) expect(normalizeSpec(p.spec)).toEqual(p.spec);
  });

  it('clamps nonsense instead of throwing', () => {
    const s = normalizeSpec({ format: 'rounds', rounds: -4, workS: Number.NaN, restS: 1e9 });
    expect(s.rounds).toBe(1);
    expect(s.workS).toBe(180);
    expect(s.restS).toBe(1800);
  });
});

describe('phaseAt and the clock', () => {
  const r: TimerSpec = normalizeSpec({ format: 'rounds', rounds: 3, workS: 180, restS: 60 });
  it('reads work, rest and done from seconds since the start', () => {
    const s = schedule(r);
    expect(phaseAt(s, 0)).toMatchObject({ index: 0, remainingS: 180, done: false });
    expect(phaseAt(s, 200).phase).toMatchObject({ kind: 'rest', round: 1 });
    expect(phaseAt(s, 200).remainingS).toBe(40);
    expect(phaseAt(s, totalS(r)).done).toBe(true);
    expect(phaseLine(r, phaseAt(s, 250))).toBe('Rounds · Round 2 of 3');
  });

  it('after a 40 s gap the phase is where the wall clock says, and the missed bells are counted', () => {
    const s = schedule(tabata);
    // the page was away from t=15 to t=55: three boundaries (20, 30, 50) passed
    expect(boundaryCrossed(s, 15, 55)).toBe(3);
    expect(phaseAt(s, 55)).toMatchObject({ phase: { kind: 'rest', round: 2 }, remainingS: 5 });
    expect(boundaryCrossed(s, 55, 55)).toBe(0);
  });
});

describe('timerSegments', () => {
  it('marks Tabata rounds and rests at the timer’s offset in the recording', () => {
    const segs = timerSegments(tabata, 100, 100 + totalS(tabata));
    expect(segs.filter(s => s.kind === 'round')).toHaveLength(8);
    expect(segs.filter(s => s.kind === 'recovery')).toHaveLength(7);
    expect(segs[0]).toEqual({ id: 'round-100-1', kind: 'round', from_s: 100, to_s: 120, label: 'Round 1' });
  });

  it('a stopped timer marks only what ran, never a stub under 5 s', () => {
    const r = normalizeSpec({ format: 'rounds', rounds: 3, workS: 180, restS: 60 });
    const segs = timerSegments(r, 0, 183); // 3 s into the first rest
    expect(segs).toEqual([{ id: 'round-0-1', kind: 'round', from_s: 0, to_s: 180, label: 'Round 1' }]);
  });

  it('AMRAP rounds are the athlete’s taps', () => {
    const a = normalizeSpec({ format: 'amrap', workS: 600 });
    const segs = timerSegments(a, 10, 610, [130, 260, 262, 400]);
    expect(segs.map(s => [s.from_s, s.to_s])).toEqual([[10, 130], [130, 260], [262, 400]]);
    expect(segs.every(s => s.kind === 'round')).toBe(true);
  });

  it('a long EMOM keeps under the 50-segment cap by dropping the rests', () => {
    const e = normalizeSpec({ format: 'emom', rounds: 40, workS: 40 });
    const segs = timerSegments(e, 0, totalS(e));
    expect(segs.length).toBeLessThanOrEqual(50);
    expect(segs.every(s => s.kind === 'round')).toBe(true);
    expect(segs).toHaveLength(40);
  });
});
