import { describe, expect, it } from 'vitest';
import { matchClosedLine, matchSetLine, matchSetRecipients } from '../match-bells';
import { matchBellCopy } from '../notify';

const g = (members: Array<[string, 1 | 2 | null]>, complete = true) => ({ members: members.map(([participant_id, side]) => ({ participant_id, side })), complete });

describe('the match bells (213)', () => {
  it('`set` goes to every member of a complete match whose match changed — a re-save bells nobody, an incomplete group bells nobody', () => {
    const first = matchSetRecipients([], [g([['a', 1], ['b', 2]]), g([['c', 1]], false)]);
    expect(first).toEqual([{ participant_id: 'a', partner: [], opponents: ['b'] }, { participant_id: 'b', partner: [], opponents: ['a'] }]);
    expect(matchSetRecipients([g([['a', 1], ['b', 2]])], [g([['a', 1], ['b', 2]])])).toEqual([]);
    // A new opponent for a, a first placement for c; b's match changed too (a new opponent).
    const next = matchSetRecipients([g([['a', 1], ['b', 2]])], [g([['a', 1], ['c', 2]]), g([['b', 1], ['d', 2]])]);
    expect(next.map(r => r.participant_id)).toEqual(['a', 'c', 'b', 'd']);
    // Pairs: the partner rides along; a side swap of the same four is a change.
    const pairs = matchSetRecipients([], [g([['a', 1], ['b', 1], ['c', 2], ['d', 2]])]);
    expect(pairs[0]).toEqual({ participant_id: 'a', partner: ['b'], opponents: ['c', 'd'] });
    expect(matchSetRecipients([g([['a', 1], ['b', 1], ['c', 2], ['d', 2]])], [g([['a', 1], ['c', 1], ['b', 2], ['d', 2]])])).toHaveLength(4);
  });
  it('the lines and the copy: "You play Bob" · "You and Al play Bob & Ben" · "You beat Bob 3&2" · "Bob beat you · conceded"; one type, the round\'s Matches tab', () => {
    expect(matchSetLine([], ['Bob'])).toBe('You play Bob');
    expect(matchSetLine(['Al'], ['Bob', 'Ben'])).toBe('You and Al play Bob & Ben');
    expect(matchClosedLine(true, [], ['Bob'], '3&2')).toBe('You beat Bob 3&2');
    expect(matchClosedLine(false, [], ['Bob'], 'conceded')).toBe('Bob beat you · conceded');
    expect(matchClosedLine(true, ['Al'], ['Bob', 'Ben'], '2 up')).toBe('You and Al beat Bob & Ben 2 up');
    expect(matchClosedLine(false, [], ['Bob'], null)).toBe('Bob beat you');
    expect(matchBellCopy('set', { eventId: 'e1', eventName: 'Cup', roundId: 'r2', line: 'You play Bob' })).toEqual({ type: 'sport_event_match', title: 'You play Bob in Cup', message: 'Your match is set — see the draw.', action_url: '/events/e1?tab=matches&round=r2' });
    expect(matchBellCopy('won', { eventId: 'e1', eventName: 'Cup', roundId: 'r2', line: 'You beat Bob 3&2' })).toMatchObject({ type: 'sport_event_match', title: 'You beat Bob 3&2 in Cup' });
    expect(matchBellCopy('lost', { eventId: 'e1', eventName: 'Cup', roundId: 'r2', line: 'Bob beat you 3&2' }).message).toBe('See how the round ended.');
  });
});
