import { describe, expect, it } from 'vitest';
import { matchOutcomeEntries, type MatchForOutcome } from '../match-outcomes';

const m = (over: Partial<MatchForOutcome>): MatchForOutcome => ({
  bye: false,
  sides: [{ side: 1, members: [{ profile_id: 'A' }, { profile_id: 'B' }] }, { side: 2, members: [{ profile_id: 'C' }] }],
  state: { winnerSide: null },
  stored: { winner_side: null },
  ...over,
});

describe('matchOutcomeEntries (244)', () => {
  it('every member of the winning side wins; the other side loses', () => {
    expect(matchOutcomeEntries([m({ state: { winnerSide: 2 } })])).toEqual([
      { profileId: 'A', side: 1, outcome: 'loss' },
      { profileId: 'B', side: 1, outcome: 'loss' },
      { profileId: 'C', side: 2, outcome: 'win' },
    ]);
  });
  it('a stored decision wins over the computation (the organizer, a concession)', () => {
    expect(matchOutcomeEntries([m({ state: { winnerSide: 2 }, stored: { winner_side: 1 } })]).find(e => e.profileId === 'C')?.outcome).toBe('loss');
  });
  it('a bye and an undecided match stamp nothing', () => {
    expect(matchOutcomeEntries([m({ bye: true, stored: { winner_side: 1 } }), m({})])).toEqual([]);
  });
});
