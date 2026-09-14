import { describe, expect, it } from 'vitest';
import { buildMintPlan, buildRoundHoleData, ratingForTee, roundVisibility } from '../rounds';

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
