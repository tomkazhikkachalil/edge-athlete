import { describe, expect, it } from 'vitest';
import {
  buildResultPayload,
  matchCourseIds,
  netScore,
  pickRound,
  qualifyRound,
  ratingForRound,
  scoreForRule,
  type RoundRow,
} from '../golf-league';

const round = (over: Partial<RoundRow> = {}): RoundRow => ({
  id: 'r1',
  profile_id: 'p1',
  date: '2026-09-03',
  course_id: 'c9',
  tee: 'White',
  holes: 9,
  gross_score: 41,
  course_rating: null,
  slope_rating: null,
  par: 36,
  round_type: 'outdoor',
  is_complete: true,
  created_at: '2026-09-03T18:00:00Z',
  group_post_id: null,
  ...over,
});
const spec = { holes: 9 as const, playFrom: '2026-09-01', playTo: '2026-09-07' };
const courses = new Set(['c9']);
const nineHoles = Array.from({ length: 9 }, (_, i) => ({ hole_number: i + 1, strokes: 4 + (i % 2) }));

describe('golf-league (pure)', () => {
  it('matchCourseIds: a club link takes every section, a course link itself', () => {
    const rows = [{ id: 'a', club_id: 'club' }, { id: 'b', club_id: 'club' }, { id: 'c', club_id: 'other' }];
    expect([...matchCourseIds({ golfClubId: 'club', golfCourseId: null }, rows)].sort()).toEqual(['a', 'b']);
    expect([...matchCourseIds({ golfClubId: null, golfCourseId: 'c' }, rows)]).toEqual(['c']);
    expect(matchCourseIds({ golfClubId: null, golfCourseId: null }, rows).size).toBe(0);
  });

  it('qualifyRound counts holes from the CARD, never the course', () => {
    expect(qualifyRound(round(), nineHoles, spec, courses)).toEqual({ ok: true, holes: 9, holesSource: 'card' });
    // An 18-hole card on a 9-hole round: rejected by the card, whatever golf_rounds.holes says.
    const eighteen = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, strokes: 4 }));
    expect(qualifyRound(round({ holes: 9 }), eighteen, spec, courses)).toMatchObject({ ok: false, reason: 'played 18, round is 9' });
    // Quick entry (no hole rows) falls back to the ROUND's own declaration.
    expect(qualifyRound(round(), [], spec, courses)).toEqual({ ok: true, holes: 9, holesSource: 'declared' });
    expect(qualifyRound(round({ holes: 18 }), [], spec, courses)).toMatchObject({ ok: false });
    // Zero-stroke rows don't count as played.
    expect(qualifyRound(round(), [...nineHoles, { hole_number: 10, strokes: 0 }], spec, courses)).toMatchObject({ ok: true, holes: 9 });
  });

  it('qualifyRound: window, course, completeness, indoor', () => {
    expect(qualifyRound(round({ date: '2026-08-31' }), nineHoles, spec, courses)).toMatchObject({ reason: 'outside the play window' });
    expect(qualifyRound(round({ date: '2026-09-07' }), nineHoles, spec, courses)).toMatchObject({ ok: true });
    expect(qualifyRound(round({ course_id: 'elsewhere' }), nineHoles, spec, courses)).toMatchObject({ reason: 'not at the league course' });
    expect(qualifyRound(round({ is_complete: false }), nineHoles, spec, courses)).toMatchObject({ reason: 'round not complete' });
    expect(qualifyRound(round({ round_type: 'indoor' }), nineHoles, spec, courses)).toMatchObject({ reason: 'indoor round' });
    expect(qualifyRound(round({ gross_score: null }), nineHoles, spec, courses)).toMatchObject({ reason: 'no gross score' });
  });

  it('pickRound: first posted by default, best by score', () => {
    const a = { created_at: '2026-09-02T10:00:00Z', score: 41 };
    const b = { created_at: '2026-09-04T10:00:00Z', score: 38 };
    expect(pickRound([b, a], 'first')).toBe(a);
    expect(pickRound([a, b], 'best')).toBe(b);
    expect(pickRound([], 'first')).toBeNull();
  });

  it("ratingForRound: the round's own plausible pair wins; else the tee's row for that length; an 18 never halves into a nine", () => {
    expect(ratingForRound(round({ course_rating: 35.2, slope_rating: 118 }), null, 9)).toEqual({ rating: 35.2, slope: 118, source: 'round' });
    // An 18-hole rating stored on a 9-hole round is implausible → fall through.
    const nineRow = { id: 'c9', section_kind: 'nine', total_par: 36, holes_count: 9, course_rating: { white: 34.8 }, slope_rating: { white: 115 } };
    expect(ratingForRound(round({ course_rating: 70.1, slope_rating: 125 }), nineRow, 9)).toEqual({ rating: 34.8, slope: 115, source: 'course' });
    const eighteenRow = { id: 'c18', section_kind: 'course_18', total_par: 72, holes_count: 18, course_rating: { white: 70.1 }, slope_rating: { white: 125 } };
    expect(ratingForRound(round(), eighteenRow, 9)).toBeNull();
    expect(ratingForRound(round({ holes: 18, gross_score: 85 }), eighteenRow, 18)).toEqual({ rating: 70.1, slope: 125, source: 'course' });
    // Unrated tee → null (no invented rating).
    expect(ratingForRound(round({ tee: 'Gold' }), nineRow, 9)).toBeNull();
    expect(ratingForRound(round({ tee: null }), nineRow, 9)).toBeNull();
  });

  it('netScore halves the index for nine holes (6.1a) and the payload carries the proof', () => {
    const pair = { rating: 35.2, slope: 118, source: 'round' as const };
    // 18-hole: CH = round(12 × 118/113 + (70.1 − 72)) = round(12.53 − 1.9) = 11
    expect(netScore(85, 12, { rating: 70.1, slope: 125, source: 'course' }, 72, 18)).toEqual({ courseHandicap: 11, net: 74 });
    // 9-hole: CH = round(6 × 118/113 + (35.2 − 36)) = round(6.27 − 0.8) = 5
    expect(netScore(41, 12, pair, 36, 9)).toEqual({ courseHandicap: 5, net: 36 });
    const payload = buildResultPayload({ round: round(), holes: 9, holesSource: 'card', pair, index: 12, par: 36 });
    expect(payload).toMatchObject({ gross: 41, net: 36, courseHandicap: 5, index: 12, holes: 9, tee: 'White', ratingSource: 'round' });
    expect(payload.roundRef).toEqual({ roundId: 'r1', groupPostId: null });
    const grossOnly = buildResultPayload({ round: round(), holes: 9, holesSource: 'card', pair: null, index: 12, par: 36 });
    expect(grossOnly).toMatchObject({ gross: 41, noRating: true });
    expect('net' in grossOnly).toBe(false);
    // A rated tee but no index yet: gross-only with THAT reason.
    const noIndex = buildResultPayload({ round: round(), holes: 9, holesSource: 'card', pair, index: null, par: 36 });
    expect(noIndex).toMatchObject({ gross: 41, noIndex: true });
    expect('noRating' in noIndex).toBe(false);
    expect(scoreForRule('golf_net', payload)).toBe(36);
    expect(scoreForRule('golf_net', grossOnly)).toBe(41);
    expect(scoreForRule('golf_gross', payload)).toBe(41);
  });
});
