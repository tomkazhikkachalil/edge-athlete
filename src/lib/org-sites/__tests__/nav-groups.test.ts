import { describe, expect, it } from 'vitest';
import { groupTeamsForNav } from '../nav-groups';

const t = (id: string, name: string, div?: string) => ({ id, name, divisionLabels: div ? [div] : [] });

describe('groupTeamsForNav', () => {
  it('groups by the first division label, in the reader’s order', () => {
    const out = groupTeamsForNav([t('1', 'Comets', 'U13'), t('2', 'Blazers', 'U15'), t('3', 'Rockets', 'U13')]);
    expect(out.groups).toEqual([
      { label: 'U13', teams: [{ id: '1', name: 'Comets' }, { id: '3', name: 'Rockets' }] },
      { label: 'U15', teams: [{ id: '2', name: 'Blazers' }] },
    ]);
    expect(out.truncated).toBe(false);
  });

  it('teams without a division read last; alone, they are one unlabelled list', () => {
    expect(groupTeamsForNav([t('1', 'A'), t('2', 'B', 'U13')]).groups.map(g => g.label)).toEqual(['U13', null]);
    expect(groupTeamsForNav([t('1', 'A'), t('2', 'B')]).groups).toEqual([{ label: null, teams: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] }]);
  });

  it('caps the list and says so (All teams covers the rest)', () => {
    const many = Array.from({ length: 30 }, (_, i) => t(String(i), `Team ${i}`, 'U13'));
    const out = groupTeamsForNav(many, 24);
    expect(out.groups[0].teams).toHaveLength(24);
    expect(out.truncated).toBe(true);
  });

  it('no teams → no groups', () => {
    expect(groupTeamsForNav([])).toEqual({ groups: [], truncated: false });
  });
});
