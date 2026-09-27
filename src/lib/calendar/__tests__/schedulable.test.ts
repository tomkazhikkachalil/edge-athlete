import { describe, expect, it } from 'vitest';
import { schedulableScopes } from '../schedulable';

// The event form offers exactly what the event routes accept.

const structure = {
  divisions: [{ id: 'd1', name: 'U13' }, { id: 'd2', name: 'U15' }],
  teams: [
    { id: 't1', name: 'Blazers', divisionIds: ['d1'] },
    { id: 't2', name: 'Comets', divisionIds: ['d1'] },
    { id: 't3', name: 'Rockets', divisionIds: ['d2'] },
  ],
};
const none = { role: null, admin: false, sections: [], scoped: [] };

describe('schedulableScopes', () => {
  it('an owner or manager: the whole org, every division and team', () => {
    const out = schedulableScopes({ ...none, role: 'manager' }, structure)!;
    expect(out.wholeOrg).toBe(true);
    expect(out.divisions).toHaveLength(2);
    expect(out.teams.map(t => t.id)).toEqual(['t1', 't2', 't3']);
  });
  it('a team coach: only their team, never the whole org', () => {
    const out = schedulableScopes({ ...none, role: 'member', scoped: [{ scopeType: 'team', scopeId: 't2', sections: ['teams'] }] }, structure)!;
    expect(out).toEqual({ wholeOrg: false, divisions: [], teams: [{ id: 't2', name: 'Comets' }] });
  });
  it("a division's scheduler: the division and the teams entered in it", () => {
    const out = schedulableScopes({ ...none, scoped: [{ scopeType: 'division', scopeId: 'd1', sections: ['competitions'] }] }, structure)!;
    expect(out.divisions.map(d => d.id)).toEqual(['d1']);
    expect(out.teams.map(t => t.id)).toEqual(['t1', 't2']);
  });
  it('a plain member, or a grant that neither runs nor schedules: nothing to offer', () => {
    expect(schedulableScopes({ ...none, role: 'member' }, structure)).toBeNull();
    expect(schedulableScopes({ ...none, scoped: [{ scopeType: 'team', scopeId: 't1', sections: ['roster'] }] }, structure)).toBeNull();
  });
});
