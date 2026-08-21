import { describe, it, expect } from 'vitest';
import {
  firstUnscoredHole,
  hasAnyEnteredScore,
  resizePlayerScores,
  parseDraft,
  mergeDraftIntoHoles,
  DRAFT_TTL_MS,
  type ScoreDraft,
  type DraftHole,
} from '../score-entry';

const scores = (...holes: number[]) => holes.map(hole_number => ({ hole_number }));

describe('firstUnscoredHole', () => {
  it('starts at 1 when nothing is scored', () => {
    expect(firstUnscoredHole([], 18)).toBe(1);
  });

  it('resumes after a contiguous run (holes 1-5 scored → position 6)', () => {
    expect(firstUnscoredHole(scores(1, 2, 3, 4, 5), 18)).toBe(6);
  });

  it('lands on a gap (scored 1-3, skipped 4, scored 5 → position 4)', () => {
    expect(firstUnscoredHole(scores(1, 2, 3, 5), 18)).toBe(4);
  });

  it('lands on the LAST position when everything is scored (edit flow)', () => {
    const all18 = scores(...Array.from({ length: 18 }, (_, i) => i + 1));
    expect(firstUnscoredHole(all18, 18)).toBe(18);
  });

  it('handles back-9 rounds (startingHoleNumber 10; scored 10-12 → position 4)', () => {
    expect(firstUnscoredHole(scores(10, 11, 12), 9, 10)).toBe(4);
  });

  it('handles 9-hole rounds', () => {
    expect(firstUnscoredHole(scores(1, 2), 9)).toBe(3);
    const all9 = scores(...Array.from({ length: 9 }, (_, i) => i + 1));
    expect(firstUnscoredHole(all9, 9)).toBe(9);
  });

  it('ignores scores outside the round window', () => {
    // Front-9 modal shouldn't be confused by (bad) back-9 rows
    expect(firstUnscoredHole(scores(15, 16), 9, 1)).toBe(1);
  });

  it('degrades safely on malformed holesPlayed', () => {
    expect(firstUnscoredHole([], 0)).toBe(1);
  });
});

const NOW = 1_800_000_000_000;
const draftHole = (strokes: number | null): DraftHole =>
  ({ strokes, putts: null, fairway_hit: null, green_in_regulation: null, penalties: null });
const validDraft = (over: Partial<ScoreDraft> = {}): string => JSON.stringify({
  v: 2,
  participantId: 'p1',
  savedAt: NOW - 1000,
  holes: { 7: draftHole(5) },
  ...over,
});

describe('parseDraft', () => {
  it('accepts a valid draft', () => {
    const d = parseDraft(validDraft(), 'p1', NOW);
    expect(d?.holes[7].strokes).toBe(5);
  });

  it('rejects null, garbage JSON, and wrong shapes', () => {
    expect(parseDraft(null, 'p1', NOW)).toBeNull();
    expect(parseDraft('not json{', 'p1', NOW)).toBeNull();
    expect(parseDraft('"a string"', 'p1', NOW)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 3 }), 'p1', NOW)).toBeNull();
    expect(parseDraft(validDraft({ holes: [1, 2] as unknown as ScoreDraft['holes'] }), 'p1', NOW)).toBeNull();
  });

  it('rejects a pre-penalties v1 draft (silently discarded — intended)', () => {
    expect(parseDraft(validDraft({ v: 1 } as unknown as Partial<ScoreDraft>), 'p1', NOW)).toBeNull();
  });

  it('rejects another participant\'s draft', () => {
    expect(parseDraft(validDraft(), 'p2', NOW)).toBeNull();
  });

  it('rejects the empty participantId (solo quick-entry has no draft identity)', () => {
    // "" === "" would otherwise match — one shared key across ALL solo rounds
    // would resurrect round A's typed holes inside round B.
    expect(parseDraft(validDraft({ participantId: '' }), '', NOW)).toBeNull();
  });

  it('rejects expired drafts (48h TTL)', () => {
    expect(parseDraft(validDraft({ savedAt: NOW - DRAFT_TTL_MS - 1 }), 'p1', NOW)).toBeNull();
    expect(parseDraft(validDraft({ savedAt: NOW - DRAFT_TTL_MS + 1000 }), 'p1', NOW)).not.toBeNull();
  });
});

describe('mergeDraftIntoHoles', () => {
  const hole = (hole_number: number | null, strokes: number | null = null) => ({
    hole_number, strokes, putts: null, fairway_hit: null, green_in_regulation: null, penalties: null,
  });
  const draft = (holes: Record<number, DraftHole>): ScoreDraft =>
    ({ v: 2, participantId: 'p1', savedAt: NOW, holes });

  it('restores a draft hole the server does not have', () => {
    const { holes, restored } = mergeDraftIntoHoles(
      [hole(1, 4), hole(2)],
      draft({ 2: draftHole(6) }),
      [{ hole_number: 1 }]
    );
    expect(holes[1].strokes).toBe(6);
    expect(restored).toEqual([2]);
  });

  it('NEVER overwrites a hole the server has (stale-edit protection)', () => {
    const { holes, restored } = mergeDraftIntoHoles(
      [hole(1, 4)],
      draft({ 1: draftHole(9) }),
      [{ hole_number: 1 }]
    );
    expect(holes[0].strokes).toBe(4);
    expect(restored).toEqual([]);
  });

  it('skips all-null draft entries and null draft', () => {
    const { restored } = mergeDraftIntoHoles(
      [hole(3)],
      draft({ 3: draftHole(null) }),
      []
    );
    expect(restored).toEqual([]);
    expect(mergeDraftIntoHoles([hole(1)], null, []).restored).toEqual([]);
  });

  it('restores putts-only input (partial hole worth protecting)', () => {
    const d = draft({ 4: { strokes: null, putts: 2, fairway_hit: null, green_in_regulation: null, penalties: null } });
    const { holes, restored } = mergeDraftIntoHoles([hole(4)], d, []);
    expect(holes[0].putts).toBe(2);
    expect(restored).toEqual([4]);
  });

  it('carries penalties through the merge (and restores a penalties-only hole)', () => {
    const withPenalties = draft({
      5: { ...draftHole(6), penalties: ['out_of_bounds', 'drop', 'drop'] },
      6: { ...draftHole(null), penalties: ['water'] }, // penalties-only partial input
    });
    const { holes, restored } = mergeDraftIntoHoles([hole(5), hole(6)], withPenalties, []);
    expect(holes[0].penalties).toEqual(['out_of_bounds', 'drop', 'drop']);
    expect(holes[1].penalties).toEqual(['water']);
    expect(restored).toEqual([5, 6]);
  });
});

describe('hasAnyEnteredScore', () => {
  const row = (...strokes: Array<number | undefined>) => ({
    hole_scores: strokes.map((s, i) => ({ hole_number: i + 1, strokes: s })),
  });

  it('is false for the blank creator row the composer seeds on open', () => {
    // The regression this guards: if a seeded row counted as work, opening the
    // golf composer and closing it would prompt to discard nothing.
    expect(hasAnyEnteredScore([row(undefined, undefined, undefined)])).toBe(false);
  });

  it('is false for no players at all', () => {
    expect(hasAnyEnteredScore([])).toBe(false);
  });

  it('is false for a row with no holes', () => {
    expect(hasAnyEnteredScore([{ hole_scores: [] }])).toBe(false);
  });

  it('treats a 0 as not-a-score', () => {
    // A field mid-clear can hold 0; it is not a golf score.
    expect(hasAnyEnteredScore([row(0, 0)])).toBe(false);
  });

  it('is true as soon as one real stroke is entered', () => {
    expect(hasAnyEnteredScore([row(undefined, 4)])).toBe(true);
  });

  it('is true when any player has entered, not just the first', () => {
    expect(hasAnyEnteredScore([row(undefined), row(undefined), row(5)])).toBe(true);
  });

  it('ignores negative strokes', () => {
    expect(hasAnyEnteredScore([row(-1)])).toBe(false);
  });
});

describe('resizePlayerScores', () => {
  const player = (...holes: Array<{ hole_number: number; strokes?: number }>) => ({
    participant_id: 'p1',
    hole_scores: holes,
  });

  it('grows a 9-hole row to 18, preserving entered scores', () => {
    const [out] = resizePlayerScores(
      [player({ hole_number: 1, strokes: 4 }, { hole_number: 2 })],
      18,
      1
    );
    expect(out.hole_scores).toHaveLength(18);
    expect(out.hole_scores[0]).toEqual({ hole_number: 1, strokes: 4 });
    expect(out.hole_scores[17]).toEqual({ hole_number: 18 });
  });

  it('shrinks 18 → 9, dropping the back nine', () => {
    const holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, strokes: 4 }));
    const [out] = resizePlayerScores([player(...holes)], 9, 1);
    expect(out.hole_scores).toHaveLength(9);
    expect(out.hole_scores.map(h => h.hole_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('front → back 9 renumbers to 10–18; overlapping numbers survive, others reset', () => {
    const [out] = resizePlayerScores(
      [player({ hole_number: 1, strokes: 5 }, { hole_number: 10, strokes: 3 })],
      9,
      10
    );
    expect(out.hole_scores.map(h => h.hole_number)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(out.hole_scores[0]).toEqual({ hole_number: 10, strokes: 3 });
    expect(out.hole_scores[1]).toEqual({ hole_number: 11 });
  });

  it('resizes every player, not just the first', () => {
    const out = resizePlayerScores(
      [
        { participant_id: 'a', hole_scores: [{ hole_number: 1, strokes: 4 }] },
        { participant_id: 'b', hole_scores: [{ hole_number: 1 }] },
      ],
      9,
      1
    );
    expect(out).toHaveLength(2);
    expect(out[0].hole_scores).toHaveLength(9);
    expect(out[1].hole_scores).toHaveLength(9);
    expect(out[0].participant_id).toBe('a');
  });
});
