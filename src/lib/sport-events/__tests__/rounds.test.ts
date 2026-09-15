import { describe, expect, it } from 'vitest';
import { activeRounds, buildMintPlan, buildRoundHoleData, currentRound, dateOrderRefusal, deleteRefusal, MAX_ROUNDS, nextSequence, ratingForTee, renumberAfterDelete, ROUND_DELETE_REFUSAL_COPY, roundVisibility, type RoundLike } from '../rounds';

const catalog = { hole_data: Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, yardage: { Blue: 400 + i, white: 380 + i }, handicap: 18 - i })) };

describe('buildRoundHoleData', () => {
  it('keeps the stroke index and picks the tee yardage case-insensitively', () => {
    const d = buildRoundHoleData(catalog, 18, 1, 'blue')!;
    expect(d).toHaveLength(18);
    expect(d[0]).toEqual({ hole: 1, par: 4, yardage: 400, handicap: 18 });
    expect(buildRoundHoleData(catalog, 18, 1, 'White')![2].yardage).toBe(382);
    expect(buildRoundHoleData(catalog, 18, 1, null)![0].yardage).toBeNull();
  });
  it('a back nine is numbered 10..18; a front nine 1..9', () => {
    expect(buildRoundHoleData(catalog, 9, 10, 'Blue')!.map(h => h.hole)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(buildRoundHoleData(catalog, 9, 1, 'Blue')!.map(h => h.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('off-catalog or an incomplete catalog answers null', () => {
    expect(buildRoundHoleData(null, 18, 1, null)).toBeNull();
    expect(buildRoundHoleData({ hole_data: catalog.hole_data.slice(0, 9) }, 18, 1, null)).toBeNull();
    expect(buildRoundHoleData({ hole_data: [{ number: 1, par: 4 }, { number: 2, par: 9 }] }, 9, 1, null)).toBeNull();
  });
  it('an out-of-range stroke index is dropped, not trusted', () => {
    expect(buildRoundHoleData({ hole_data: catalog.hole_data.map(h => ({ ...h, handicap: 0 })) }, 9, 1, null)![0].handicap).toBeNull();
  });
});

describe('ratingForTee', () => {
  it('matches the tee key case-insensitively and refuses implausible numbers', () => {
    const course = { course_rating: { Blue: 71.5, white: 69.9 }, slope_rating: { Blue: 128, white: 120 } };
    expect(ratingForTee(course, 'blue')).toEqual({ course_rating: 71.5, slope_rating: 128 });
    expect(ratingForTee(course, 'WHITE')).toEqual({ course_rating: 69.9, slope_rating: 120 });
    expect(ratingForTee(course, 'red')).toEqual({ course_rating: null, slope_rating: null });
    expect(ratingForTee({ course_rating: { Blue: 9 }, slope_rating: { Blue: 300 } }, 'Blue')).toEqual({ course_rating: null, slope_rating: null });
    expect(ratingForTee(null, 'Blue')).toEqual({ course_rating: null, slope_rating: null });
  });
});

describe('buildMintPlan', () => {
  it('the host is the round creator, players follow the groups then the roster, a non-playing co-organizer is a round organizer, followers get no row', () => {
    const plan = buildMintPlan({
      hostProfileId: 'host',
      visibility: 'private',
      format: 'stroke_gross',
      players: [
        { participantId: 'pa', profileId: 'host', role: 'organizer', playing: true },
        { participantId: 'pb', profileId: 'b', role: 'participant', playing: true },
        { participantId: 'pc', profileId: 'c', role: 'participant', playing: true },
        { participantId: 'pd', profileId: 'd', role: 'co_organizer', playing: false },
        { participantId: 'pe', profileId: 'e', role: 'participant', playing: false },
      ],
      groups: [{ id: 'g2', sequence: 2, members: [{ participantId: 'pb', position: 1 }] }, { id: 'g1', sequence: 1, members: [{ participantId: 'pc', position: 1 }, { participantId: 'pa', position: 2 }] }],
    });
    expect(plan.groupPost).toEqual({ type: 'golf_round', visibility: 'participants_only' });
    expect(plan.participantRows).toEqual([
      { profile_id: 'host', role: 'creator', status: 'confirmed', position: 1 },
      { profile_id: 'c', role: 'participant', status: 'confirmed', position: 2 },
      { profile_id: 'b', role: 'participant', status: 'confirmed', position: 3 },
      { profile_id: 'd', role: 'organizer', status: 'confirmed', position: 4 },
    ]);
    expect(roundVisibility('public')).toBe('public');
    expect(roundVisibility('link')).toBe('participants_only');
  });
});

describe('the rounds list (phase 2)', () => {
  const r = (id: string, sequence: number, scheduled_on: string, status: RoundLike['status'] = 'scheduled'): RoundLike => ({ id, sequence, scheduled_on, status });
  const three = [r('a', 1, '2030-06-01', 'completed'), r('b', 2, '2030-06-02', 'live'), r('c', 3, '2030-06-03')];

  it('nextSequence is one past the highest — a cancelled round keeps its slot', () => {
    expect(nextSequence([])).toBe(1);
    expect(nextSequence(three)).toBe(4);
    expect(nextSequence([r('a', 1, '2030-06-01'), r('b', 2, '2030-06-02', 'cancelled')])).toBe(3);
  });

  it('dateOrderRefusal — an appended round may not precede the last; an edit stays between its neighbours; cancelled rounds do not count', () => {
    expect(dateOrderRefusal(three, { sequence: null, scheduled_on: '2030-06-03' })).toBeNull();
    expect(dateOrderRefusal(three, { sequence: null, scheduled_on: '2030-06-02' })).toBe('before_previous');
    expect(dateOrderRefusal(three, { sequence: 2, scheduled_on: '2030-06-01' })).toBeNull();
    expect(dateOrderRefusal(three, { sequence: 2, scheduled_on: '2030-05-31' })).toBe('before_previous');
    expect(dateOrderRefusal(three, { sequence: 2, scheduled_on: '2030-06-04' })).toBe('after_next');
    const withCancelled = [r('a', 1, '2030-06-01'), r('b', 2, '2030-06-09', 'cancelled'), r('c', 3, '2030-06-03')];
    expect(dateOrderRefusal(withCancelled, { sequence: null, scheduled_on: '2030-06-03' })).toBeNull();
    expect(dateOrderRefusal(withCancelled, { sequence: 3, scheduled_on: '2030-06-02' })).toBeNull();
    expect(dateOrderRefusal([], { sequence: null, scheduled_on: '2030-06-03' })).toBeNull();
  });

  it('renumberAfterDelete moves only the later rounds up, lowest first', () => {
    expect(renumberAfterDelete([r('a', 1, 'x'), r('b', 2, 'x'), r('c', 3, 'x'), r('d', 4, 'x')], 2)).toEqual([{ id: 'c', sequence: 2 }, { id: 'd', sequence: 3 }]);
    expect(renumberAfterDelete([r('a', 1, 'x'), r('b', 2, 'x')], 2)).toEqual([]);
    expect(renumberAfterDelete([r('d', 4, 'x'), r('c', 3, 'x'), r('a', 1, 'x')], 1).map(x => x.id)).toEqual(['c', 'd']);
  });

  it('deleteRefusal — only a scheduled round, never the last non-cancelled one', () => {
    expect(deleteRefusal(three[2], three)).toBeNull();
    expect(deleteRefusal(three[1], three)).toBe('not_scheduled');
    expect(deleteRefusal(three[0], three)).toBe('not_scheduled');
    const one = [r('a', 1, 'x')];
    expect(deleteRefusal(one[0], one)).toBe('last_round');
    const withCancelled = [r('a', 1, 'x'), r('b', 2, 'x', 'cancelled')];
    expect(deleteRefusal(withCancelled[0], withCancelled)).toBe('last_round');
    expect(ROUND_DELETE_REFUSAL_COPY.last_round).toContain('cancel the event');
  });

  it('currentRound: the live one, else the next scheduled, else the last completed, else the first', () => {
    expect(currentRound(three)?.id).toBe('b');
    expect(currentRound([r('a', 1, 'x', 'completed'), r('b', 2, 'x'), r('c', 3, 'x')])?.id).toBe('b');
    expect(currentRound([r('a', 1, 'x', 'completed'), r('b', 2, 'x', 'completed')])?.id).toBe('b');
    expect(currentRound([r('a', 1, 'x', 'cancelled'), r('b', 2, 'x', 'cancelled')])?.id).toBe('a');
    expect(currentRound([r('c', 3, 'x'), r('a', 1, 'x')])?.id).toBe('a');
    expect(currentRound([])).toBeNull();
  });

  it('activeRounds drops cancelled rounds and sorts by sequence', () => {
    expect(activeRounds([r('c', 3, 'x'), r('b', 2, 'x', 'cancelled'), r('a', 1, 'x')]).map(x => x.id)).toEqual(['a', 'c']);
    expect(MAX_ROUNDS).toBe(8);
  });
});
