import { describe, it, expect } from 'vitest';
import { countPartnersWithScores } from '../round-delete';

const CREATOR = 'creator-id';

const p = (
  profileId: string,
  status: string,
  scores: { holes_completed?: number | null; total_score?: number | null }
) => ({ participant: { profile_id: profileId, status }, scores });

describe('countPartnersWithScores', () => {
  it('empty roster counts zero', () => {
    expect(countPartnersWithScores([], CREATOR)).toBe(0);
  });

  it('the creator never counts as a partner, however many scores they have', () => {
    expect(
      countPartnersWithScores(
        [p(CREATOR, 'confirmed', { holes_completed: 18, total_score: 72 })],
        CREATOR
      )
    ).toBe(0);
  });

  it('partners without any scores do not count', () => {
    expect(
      countPartnersWithScores(
        [
          p('a', 'confirmed', { holes_completed: 0, total_score: null }),
          p('b', 'confirmed', {}),
        ],
        CREATOR
      )
    ).toBe(0);
  });

  it('counts partners with completed holes OR a total (leaderboard signal)', () => {
    expect(
      countPartnersWithScores(
        [
          p('a', 'confirmed', { holes_completed: 3, total_score: null }),
          p('b', 'confirmed', { holes_completed: 0, total_score: 40 }),
          p('c', 'confirmed', { holes_completed: 0, total_score: null }),
        ],
        CREATOR
      )
    ).toBe(2);
  });

  it('declined partners are excluded even with stray score rows', () => {
    expect(
      countPartnersWithScores(
        [p('a', 'declined', { holes_completed: 9, total_score: 45 })],
        CREATOR
      )
    ).toBe(0);
  });

  it("legacy pending/maybe rows count — auto-confirm lets them score", () => {
    expect(
      countPartnersWithScores(
        [
          p('a', 'pending', { holes_completed: 2 }),
          p('b', 'maybe', { total_score: 38 }),
        ],
        CREATOR
      )
    ).toBe(2);
  });
});
