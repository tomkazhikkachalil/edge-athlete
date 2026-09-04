import { describe, expect, it } from 'vitest';
import { buildHierarchy, defaultOpenSeasonId, type HierarchyPerson } from '../hierarchy';

const person = (over: Partial<HierarchyPerson>): HierarchyPerson => ({
  rowId: 'r', profileId: 'p', name: 'Pat', avatarUrl: null, role: 'staff', sections: ['teams'],
  scopeType: 'org', scopeId: null, seasonId: null, ...over,
});

describe('buildHierarchy (pure)', () => {
  const seasons = [
    { id: 's2', label: '2026', divisions: [{ id: 'd1', name: 'U13', entries: [{ team_id: 't1' }, { team_id: 't1' }, { team_id: 'ghost' }] }] },
    { id: 's1', label: '2025', archived: true, divisions: [] },
  ];
  const teams = [
    { id: 't1', name: 'Rangers' },
    { id: 't2', name: 'Hawks', display_name: 'The Hawks' },
    { id: 't3', name: 'Old', status: 'archived' },
  ];

  it('places people on their nodes, dedupes entries, drops unknown and archived teams', () => {
    const tree = buildHierarchy(seasons, teams, [
      person({ rowId: 'a', name: 'Owner', role: 'owner' }),
      person({ rowId: 'b', name: 'Zed', role: 'admin' }),
      person({ rowId: 'c', name: 'Div', scopeType: 'division', scopeId: 'd1' }),
      person({ rowId: 'd', name: 'Team', scopeType: 'team', scopeId: 't1', sections: ['roster'] }),
      person({ rowId: 'e', name: 'Hawk', scopeType: 'team', scopeId: 't2' }),
    ]);
    expect(tree.orgPeople.map(p => p.name)).toEqual(['Owner', 'Zed']);
    expect(tree.seasons.map(s => [s.id, s.archived])).toEqual([['s2', false], ['s1', true]]);
    const d1 = tree.seasons[0].divisions[0];
    expect(d1.people.map(p => p.name)).toEqual(['Div']);
    expect(d1.teams).toEqual([{ id: 't1', name: 'Rangers', people: [expect.objectContaining({ name: 'Team' })] }]);
    expect(tree.unassignedTeams.map(t => [t.name, t.people.length])).toEqual([['The Hawks', 1]]);
  });

  it('opens on the newest live season, else the newest of all', () => {
    const tree = buildHierarchy(seasons, teams, []);
    expect(defaultOpenSeasonId(tree.seasons)).toBe('s2');
    expect(defaultOpenSeasonId([{ id: 'x', label: 'x', archived: true, divisions: [] }])).toBe('x');
    expect(defaultOpenSeasonId([])).toBeNull();
  });
});
