import { describe, expect, it } from 'vitest';
import { carryMatchUnit, matchOutcomeEntries, type MatchForOutcome } from '../match-outcomes';

const m = (over: Partial<MatchForOutcome>): MatchForOutcome => ({
  id: 'M1',
  bye: false,
  sides: [{ side: 1, members: [{ profile_id: 'A' }, { profile_id: 'B' }] }, { side: 2, members: [{ profile_id: 'C' }] }],
  state: { winnerSide: null },
  stored: { winner_side: null },
  ...over,
});

describe('matchOutcomeEntries (244)', () => {
  it('every member of the winning side wins; the other side loses', () => {
    expect(matchOutcomeEntries([m({ state: { winnerSide: 2 } })])).toEqual([
      { profileId: 'A', matchId: 'M1', side: 1, outcome: 'loss' },
      { profileId: 'B', matchId: 'M1', side: 1, outcome: 'loss' },
      { profileId: 'C', matchId: 'M1', side: 2, outcome: 'win' },
    ]);
  });
  it('a stored decision wins over the computation (the organizer, a concession)', () => {
    expect(matchOutcomeEntries([m({ state: { winnerSide: 2 }, stored: { winner_side: 1 } })]).find(e => e.profileId === 'C')?.outcome).toBe('loss');
  });
  it('a bye and an undecided match stamp nothing', () => {
    expect(matchOutcomeEntries([m({ bye: true, stored: { winner_side: 1 } }), m({})])).toEqual([]);
  });
});

describe('carryMatchUnit — a re-mirror keeps the stamped match', () => {
  const row = (over: Record<string, unknown> = {}) => ({ natural_key: 'golf_round:1', context_key: 'group_post:g', context: { course: 'Pine' } as Record<string, unknown> | null, ...over });
  it('adds the stored match to a rebuilt golf row', () => {
    expect(carryMatchUnit([row()], new Map([['golf_round:1', 'M9']]))[0].context).toEqual({ course: 'Pine', match: 'M9' });
  });
  it('leaves a row alone when nothing was stamped, when it already names a match, or off golf', () => {
    expect(carryMatchUnit([row()], new Map())[0].context).toEqual({ course: 'Pine' });
    expect(carryMatchUnit([row({ context: { match: 'M2' } })], new Map([['golf_round:1', 'M9']]))[0].context).toEqual({ match: 'M2' });
    expect(carryMatchUnit([row({ context_key: 'sport_event_round:r' })], new Map([['golf_round:1', 'M9']]))[0].context).toEqual({ course: 'Pine' });
  });
});
