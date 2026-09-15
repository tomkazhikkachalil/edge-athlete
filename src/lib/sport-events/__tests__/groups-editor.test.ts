import { describe, expect, it } from 'vitest';
import { addGroup, addMinutes, assign, groupsByStanding, groupsFromSaved, localToTeeTime, moveGroup, pruneTo, removeGroup, reorderMembers, samePlan, teeTimeToLocal, toPlanBody, unassign, unassigned, updateGroup, type EditorGroup } from '../groups-editor';
import { parseEventTab, tabsFor } from '../tabs';

const g = (key: string, members: string[], over: Partial<EditorGroup> = {}): EditorGroup => ({ key, name: '', teeTime: '', startingHole: 1, members, ...over });

describe('the groups editor operations', () => {
  it('reads the saved plan in sequence and position order', () => {
    const saved = groupsFromSaved([
      { id: 'b', sequence: 2, name: null, tee_time: null, starting_hole: 10, members: [{ participant_id: 'y', position: 2 }, { participant_id: 'x', position: 1 }] },
      { id: 'a', sequence: 1, name: 'Early', tee_time: null, starting_hole: 1, members: [] },
    ]);
    expect(saved.map(s => [s.key, s.name, s.startingHole, s.members])).toEqual([['a', 'Early', 1, []], ['b', '', 10, ['x', 'y']]]);
  });
  it('assign moves a player out of any other group; unassign, reorder, move and remove keep everything else', () => {
    let groups = [g('a', ['p1']), g('b', ['p2'])];
    groups = assign(groups, 'p1', 'b');
    expect(groups.map(x => x.members)).toEqual([[], ['p2', 'p1']]);
    groups = reorderMembers(groups, 'b', ['p1', 'p2']);
    expect(groups[1].members).toEqual(['p1', 'p2']);
    expect(reorderMembers(groups, 'b', ['p1'])[1].members).toEqual(['p1', 'p2']); // a partial list is ignored
    groups = unassign(groups, 'p2');
    expect(unassigned([{ participantId: 'p1', name: 'A' }, { participantId: 'p2', name: 'B' }], groups).map(p => p.participantId)).toEqual(['p2']);
    groups = moveGroup(groups, 'b', -1);
    expect(groups.map(x => x.key)).toEqual(['b', 'a']);
    expect(moveGroup(groups, 'b', -1).map(x => x.key)).toEqual(['b', 'a']); // already first
    groups = removeGroup(groups, 'a');
    expect(groups.map(x => x.key)).toEqual(['b']);
    expect(addGroup(groups)).toHaveLength(2);
    expect(updateGroup(groups, 'b', { name: 'Late', startingHole: 10 })[0]).toMatchObject({ name: 'Late', startingHole: 10 });
    expect(pruneTo([g('a', ['p1', 'gone'])], new Set(['p1']))[0].members).toEqual(['p1']);
  });
  it('tee times round-trip through the local clock and the PUT body carries the plan', () => {
    const iso = localToTeeTime('2030-06-01', '08:10')!;
    expect(teeTimeToLocal(iso)).toBe('08:10');
    expect(localToTeeTime('2030-06-01', '')).toBeNull();
    expect(localToTeeTime('bad', '08:10')).toBeNull();
    const body = toPlanBody([g('a', ['p1'], { name: ' Early ', teeTime: '08:10', startingHole: 10 }), g('b', [])], '2030-06-01');
    expect(body.groups[0]).toMatchObject({ name: 'Early', starting_hole: 10, members: ['p1'] });
    expect(body.groups[0].tee_time).toBe(iso);
    expect(body.groups[1]).toEqual({ name: null, tee_time: null, starting_hole: 1, members: [] });
    expect(samePlan([g('a', ['p1'])], [g('z', ['p1'])])).toBe(true);
    expect(samePlan([g('a', ['p1'])], [g('a', ['p1', 'p2'])])).toBe(false);
  });
  it('the Groups tab is the organizers\'', () => {
    expect(tabsFor({ canManage: true })).toContain('groups');
    expect(tabsFor({ canManage: false })).not.toContain('groups');
    expect(parseEventTab('groups', { canManage: false })).toBe('overview');
    expect(parseEventTab('groups', { canManage: true })).toBe('groups');
  });
});

describe('groupsByStanding (phase 2)', () => {
  const row = (id: string, rank: number | null, madeCut: boolean | null = null) => ({ participantId: id, rank, madeCut });
  const seven = [row('a', 1), row('b', 2), row('c', 2), row('d', 4), row('e', 5), row('f', null), row('g', 7)];

  it('leaders last: the standing reversed, the short group first, the leaders in the last group; the unranked go out first', () => {
    const groups = groupsByStanding(seven, { groupSize: 3, order: 'leaders_last' });
    expect(groups.map(g => g.members)).toEqual([['f'], ['g', 'e', 'd'], ['c', 'b', 'a']]);
    expect(groups.map(g => g.name)).toEqual(['Group 1', 'Group 2', 'Group 3']);
    expect(groups.every(g => g.startingHole === 1 && g.teeTime === '')).toBe(true);
  });
  it('leaders first: the standing as is; tee times spaced from the first', () => {
    const groups = groupsByStanding(seven, { groupSize: 4, order: 'leaders_first', teeTimes: { first: '07:50', intervalMin: 10 } });
    expect(groups.map(g => g.members)).toEqual([['a', 'b', 'c'], ['d', 'e', 'g', 'f']]); // the unranked player at the standing's end
    expect(groups.map(g => g.teeTime)).toEqual(['07:50', '08:00']);
    expect(addMinutes('23:55', 10)).toBe('00:05');
    expect(addMinutes('bad', 10)).toBe('bad');
  });
  it('the missed-cut set is left out; an even field has no short group; the size is clamped 2..5', () => {
    const cut = [row('a', 1, true), row('b', 2, true), row('c', 3, false), row('d', 4, true), row('e', 5, true)];
    expect(groupsByStanding(cut, { groupSize: 2, order: 'leaders_last' }).map(g => g.members)).toEqual([['e', 'd'], ['b', 'a']]);
    expect(groupsByStanding([], { groupSize: 4, order: 'leaders_last' })).toEqual([]);
    expect(groupsByStanding(seven, { groupSize: 9 as unknown as 5, order: 'leaders_first' }).map(g => g.members.length)).toEqual([2, 5]);
  });
});
