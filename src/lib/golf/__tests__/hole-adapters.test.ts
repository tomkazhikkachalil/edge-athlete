import { describe, it, expect } from 'vitest';
import { holeDataToPlayerScores, applyPlayerScoreChange } from '../hole-adapters';
import type { HoleData } from '@/types/golf';

const holes = (): HoleData[] => [
  { hole: 1, par: 4, yardage: 380, score: 4, putts: 2, fairway: 'hit', gir: true },
  { hole: 2, par: 4, yardage: 410, score: 5, putts: 2, fairway: 'right', gir: false },
  { hole: 3, par: 3, yardage: 150, score: 3, putts: 1, fairway: 'na', penalties: ['water'] },
  { hole: 4, par: 5, yardage: 520 }, // untouched hole
];

describe('holeDataToPlayerScores (forward: form HoleData → grid rows)', () => {
  it('maps every numbered hole, scored or not', () => {
    const { participant_id, hole_scores } = holeDataToPlayerScores(holes(), 'solo');
    expect(participant_id).toBe('solo');
    expect(hole_scores.map(h => h.hole_number)).toEqual([1, 2, 3, 4]);
    expect(hole_scores[3]).toEqual({
      hole_number: 4,
      strokes: undefined,
      putts: undefined,
      fairway_hit: undefined,
      green_in_regulation: undefined,
      penalties: null,
    });
  });

  it("fairway enum → boolean: 'hit' true; 'left'/'right' false; 'na'/unset undefined", () => {
    const { hole_scores } = holeDataToPlayerScores(holes(), 'p1');
    expect(hole_scores[0].fairway_hit).toBe(true);
    expect(hole_scores[1].fairway_hit).toBe(false);
    expect(hole_scores[2].fairway_hit).toBeUndefined(); // 'na' (par 3)
    expect(hole_scores[3].fairway_hit).toBeUndefined(); // unset

    const left = holeDataToPlayerScores(
      [{ hole: 5, par: 4, fairway: 'left' }], 'p1'
    ).hole_scores[0];
    expect(left.fairway_hit).toBe(false);
  });

  it('carries strokes, putts, GIR and penalties through', () => {
    const { hole_scores } = holeDataToPlayerScores(holes(), 'p1');
    expect(hole_scores[0]).toMatchObject({
      strokes: 4, putts: 2, green_in_regulation: true, penalties: null,
    });
    expect(hole_scores[2].penalties).toEqual(['water']);
  });

  it('skips rows without a hole number', () => {
    const data: HoleData[] = [{ par: 4 }, { hole: 1, par: 4, score: 4 }];
    expect(holeDataToPlayerScores(data, 'p1').hole_scores).toHaveLength(1);
  });
});

describe('applyPlayerScoreChange (backward: grid patch → form HoleData)', () => {
  it('applies a strokes patch to the right hole and returns a NEW array', () => {
    const prev = holes();
    const next = applyPlayerScoreChange(prev, 2, { strokes: 6 });
    expect(next).not.toBe(prev);
    expect(next[1].score).toBe(6);
    expect(prev[1].score).toBe(5); // input untouched
  });

  it('untouched holes keep identity', () => {
    const prev = holes();
    const next = applyPlayerScoreChange(prev, 2, { strokes: 6 });
    expect(next[0]).toBe(prev[0]);
    expect(next[2]).toBe(prev[2]);
    expect(next[3]).toBe(prev[3]);
  });

  it('unknown hole number is a no-op', () => {
    const prev = holes();
    expect(applyPlayerScoreChange(prev, 99, { strokes: 4 })).toBe(prev);
  });

  it('clears strokes/putts when the patch carries undefined for them', () => {
    const next = applyPlayerScoreChange(holes(), 1, { strokes: undefined, putts: undefined });
    expect(next[0].score).toBeUndefined();
    expect(next[0].putts).toBeUndefined();
  });

  it("fairway boolean → enum: true 'hit'; false keeps an existing direction, else 'left'", () => {
    const hitToMiss = applyPlayerScoreChange(holes(), 1, { fairway_hit: false });
    expect(hitToMiss[0].fairway).toBe('left'); // was 'hit' — no direction to keep

    const keepRight = applyPlayerScoreChange(holes(), 2, { fairway_hit: false });
    expect(keepRight[1].fairway).toBe('right'); // direction preserved

    const toHit = applyPlayerScoreChange(holes(), 2, { fairway_hit: true });
    expect(toHit[1].fairway).toBe('hit');
  });

  it("par-3 holes pin fairway to 'na'; fairway_hit undefined keeps the form value", () => {
    const par3 = applyPlayerScoreChange(holes(), 3, { fairway_hit: true });
    expect(par3[2].fairway).toBe('na');

    const kept = applyPlayerScoreChange(holes(), 2, { strokes: 5, fairway_hit: undefined });
    expect(kept[1].fairway).toBe('right');
  });

  it('penalties: set carries through; null/undefined clears to null', () => {
    const set = applyPlayerScoreChange(holes(), 1, { penalties: ['drop', 'drop'] });
    expect(set[0].penalties).toEqual(['drop', 'drop']);

    const cleared = applyPlayerScoreChange(holes(), 3, { penalties: undefined });
    expect(cleared[2].penalties).toBeNull();
  });

  it('auto-GIR on strokes/putts change (both present), unless GIR set explicitly', () => {
    // Par 4, score 4, putts 2 → reached in 2 = par-2 → GIR true
    const auto = applyPlayerScoreChange(holes(), 2, { strokes: 4 });
    expect(auto[1].gir).toBe(true);

    // Explicit GIR wins over the recompute
    const explicit = applyPlayerScoreChange(holes(), 2, { strokes: 4, green_in_regulation: false });
    expect(explicit[1].gir).toBe(false);

    // GIR undefined in the patch (quick-entry never toggled it) keeps existing
    const kept = applyPlayerScoreChange(holes(), 1, { green_in_regulation: undefined });
    expect(kept[0].gir).toBe(true);

    // No putts → no recompute (matches the old table's guard)
    const noPutts = applyPlayerScoreChange(holes(), 4, { strokes: 5 });
    expect(noPutts[3].gir).toBeUndefined();
  });

  it('round-trips through the forward map', () => {
    // hit → true → hit; right → false → right; batch patch mirrors quick-entry
    let data = holes();
    const forward = holeDataToPlayerScores(data, 'solo').hole_scores;
    for (const row of forward) {
      if (typeof row.strokes !== 'number') continue;
      data = applyPlayerScoreChange(data, row.hole_number, {
        strokes: row.strokes,
        putts: row.putts,
        fairway_hit: row.fairway_hit,
        green_in_regulation: row.green_in_regulation,
        penalties: row.penalties ?? null,
      });
    }
    const again = holeDataToPlayerScores(data, 'solo').hole_scores;
    expect(again).toEqual(forward);
    expect(data[1].fairway).toBe('right'); // direction survived the round-trip
    expect(data[2].penalties).toEqual(['water']);
  });
});
