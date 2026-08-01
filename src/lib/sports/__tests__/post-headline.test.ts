import { describe, it, expect } from 'vitest';
import { buildPostHeadline } from '../post-headline';

describe('buildPostHeadline — golf', () => {
  const round = (over: Record<string, unknown> = {}) => ({
    course: 'Eagle Creek',
    gross_score: 76,
    golf_holes: Array.from({ length: 18 }, () => ({ par: 4 })), // par 72
    ...over,
  });

  it('leads with the course and the score', () => {
    expect(buildPostHeadline('golf', { golfRound: round() })).toEqual({
      moment: 'Eagle Creek',
      value: '76',
      label: '+4',
    });
  });

  it('signs under-par and names even par', () => {
    expect(buildPostHeadline('golf', { golfRound: round({ gross_score: 70 }) })!.label).toBe('-2');
    expect(buildPostHeadline('golf', { golfRound: round({ gross_score: 72 }) })!.label).toBe('Even');
  });

  it('falls back to "Score" when par is unknown', () => {
    // Legacy rounds carry no hole data, so to-par is not derivable — say
    // nothing rather than claiming a par that was never recorded.
    expect(buildPostHeadline('golf', { golfRound: round({ golf_holes: [] }) })!.label).toBe('Score');
    expect(buildPostHeadline('golf', { golfRound: round({ golf_holes: null }) })!.label).toBe('Score');
  });

  it('falls back to "Round" when the course is missing or blank', () => {
    expect(buildPostHeadline('golf', { golfRound: round({ course: null }) })!.moment).toBe('Round');
    expect(buildPostHeadline('golf', { golfRound: round({ course: '   ' }) })!.moment).toBe('Round');
  });

  it('returns null without a score — nothing worth overlaying', () => {
    expect(buildPostHeadline('golf', { golfRound: round({ gross_score: null }) })).toBeNull();
    expect(buildPostHeadline('golf', { golfRound: null })).toBeNull();
    expect(buildPostHeadline('golf', {})).toBeNull();
  });

  it('handles a score of 0 without treating it as absent', () => {
    // Falsy but a real number; a truthiness check would drop it.
    expect(buildPostHeadline('golf', { golfRound: round({ gross_score: 0 }) })!.value).toBe('0');
  });
});

describe('buildPostHeadline — stat-line sports', () => {
  const line = (over: Record<string, unknown> = {}) => ({
    type: 'stat_line',
    sport_key: 'ice_hockey',
    opponent: 'Rivals HC',
    result: 'W',
    result_score: '4-2',
    stats: { goals: 2, assists: 1 },
    ...over,
  });

  it('uses the sport schema headline and the opponent', () => {
    const h = buildPostHeadline('ice_hockey', { statsData: line() })!;
    expect(h.moment).toBe('Rivals HC');
    expect(h.value.length).toBeGreaterThan(0);
    expect(h.label).toBe('W 4-2');
  });

  it('falls back to the activity noun with no opponent', () => {
    expect(buildPostHeadline('ice_hockey', { statsData: line({ opponent: null }) })!.moment)
      .toBe('Game');
  });

  it('omits the score from the label when there is none', () => {
    expect(buildPostHeadline('ice_hockey', { statsData: line({ result_score: null }) })!.label)
      .toBe('W');
  });

  it('returns null when no stats were entered', () => {
    expect(buildPostHeadline('ice_hockey', { statsData: line({ stats: {} }) })).toBeNull();
  });
});

describe('buildPostHeadline — nothing to say', () => {
  it('returns null for a plain post', () => {
    expect(buildPostHeadline(null, {})).toBeNull();
    expect(buildPostHeadline('training', { statsData: null })).toBeNull();
    expect(buildPostHeadline('golf', { statsData: { type: 'something_else' } })).toBeNull();
  });
});

describe('buildPostHeadline — shared rounds', () => {
  // A shared round posts with a group_scorecard and NO golf_round. Handling
  // only golf_round left every live/shared round — the whole point of the
  // media work — with no headline at all.
  const card = (over: Record<string, unknown> = {}) => ({
    golf_data: { course_name: 'Eagle Creek' },
    participants: [
      { participant: { profile_id: 'me' }, scores: { total_score: 82, to_par: 10 } },
      { participant: { profile_id: 'other' }, scores: { total_score: 74, to_par: 2 } },
    ],
    ...over,
  });

  it('leads with YOUR score when you played', () => {
    expect(buildPostHeadline('golf', { groupScorecard: card(), viewerId: 'me' })).toEqual({
      moment: 'Eagle Creek',
      value: '82',
      label: '+10',
    });
  });

  it('falls back to the best score for a viewer who did not play', () => {
    expect(buildPostHeadline('golf', { groupScorecard: card(), viewerId: 'stranger' })!.value)
      .toBe('74');
    expect(buildPostHeadline('golf', { groupScorecard: card() })!.value).toBe('74');
  });

  it('prefers the shared round over a golf_round when both are present', () => {
    const h = buildPostHeadline('golf', {
      groupScorecard: card(),
      golfRound: { course: 'Somewhere Else', gross_score: 99, golf_holes: [] },
      viewerId: 'me',
    })!;
    expect(h.moment).toBe('Eagle Creek');
    expect(h.value).toBe('82');
  });

  it('returns null when nobody has scored yet', () => {
    expect(buildPostHeadline('golf', { groupScorecard: card({ participants: [] }) })).toBeNull();
    expect(
      buildPostHeadline('golf', {
        groupScorecard: card({ participants: [{ participant: { profile_id: 'me' }, scores: {} }] }),
      })
    ).toBeNull();
  });

  it('says "Score" when to_par was never computed', () => {
    const h = buildPostHeadline('golf', {
      groupScorecard: card({
        participants: [{ participant: { profile_id: 'me' }, scores: { total_score: 80 } }],
      }),
    })!;
    expect(h.label).toBe('Score');
  });
});
