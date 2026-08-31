import { describe, expect, it } from 'vitest';
import { scopedMemberProfileIds, scopedMembershipExists, viewerScopeSet } from '../scoped-members';

type Admin = Parameters<typeof viewerScopeSet>[0];

interface RecordedCall {
  table: string;
  filters: Record<string, unknown>;
}

function mockAdmin(results: Partial<Record<string, { data?: unknown; error?: { code: string } | null }>>) {
  const calls: RecordedCall[] = [];
  const admin = {
    from(table: string) {
      const call: RecordedCall = { table, filters: {} };
      calls.push(call);
      const result = { data: null, error: null, ...(results[table] ?? {}) };
      const chain = {
        eq(col: string, val: unknown) {
          call.filters[col] = val;
          return chain;
        },
        in(col: string, vals: unknown) {
          call.filters[col] = vals;
          return chain;
        },
        limit: () => chain,
        select: () => chain,
        maybeSingle: async () => result,
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return { select: () => chain };
    },
  };
  return { admin: admin as unknown as Admin, calls };
}

describe('viewerScopeSet', () => {
  it('no scoped rows → empty set, no structure reads', async () => {
    const { admin, calls } = mockAdmin({ memberships: { data: [] } });
    const set = await viewerScopeSet(admin, 'p1');
    expect(set.divisionIds).toEqual([]);
    expect(set.teamIds).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0].filters).toMatchObject({ profile_id: 'p1', scope_type: ['division', 'team'] });
  });

  it('team row expands to entered divisions + owning org, with scopeOrg map', async () => {
    const { admin } = mockAdmin({
      memberships: { data: [{ scope_type: 'team', scope_id: 'team-1' }] },
      team_entries: { data: [{ division_id: 'div-1' }] },
      teams: { data: [{ id: 'team-1', league_id: 'lg-1', club_id: null }] },
      divisions: { data: [{ id: 'div-1', league_id: 'lg-1', club_id: null }] },
    });
    const set = await viewerScopeSet(admin, 'p1');
    expect(set.teamIds).toEqual(['team-1']);
    expect(set.divisionIds).toEqual(['div-1']);
    expect(set.leagueIds).toEqual(['lg-1']);
    expect(set.clubIds).toEqual([]);
    expect(set.scopeOrg.get('team-1')).toBe('lg-1');
    expect(set.scopeOrg.get('div-1')).toBe('lg-1');
  });

  it('division row (club side) carries its own scope + owning club', async () => {
    const { admin } = mockAdmin({
      memberships: { data: [{ scope_type: 'division', scope_id: 'div-2' }] },
      divisions: { data: [{ id: 'div-2', league_id: null, club_id: 'cl-1' }] },
    });
    const set = await viewerScopeSet(admin, 'p1');
    expect(set.divisionIds).toEqual(['div-2']);
    expect(set.teamIds).toEqual([]);
    expect(set.clubIds).toEqual(['cl-1']);
    expect(set.scopeOrg.get('div-2')).toBe('cl-1');
  });

  it('pre-145 database (missing table) degrades to empty', async () => {
    const { admin } = mockAdmin({ memberships: { error: { code: '42P01' } } });
    const set = await viewerScopeSet(admin, 'p1');
    expect(set.divisionIds).toEqual([]);
    expect(set.teamIds).toEqual([]);
  });
});

describe('scopedMembershipExists', () => {
  it('filters by exact scope and the given profiles', async () => {
    const { admin, calls } = mockAdmin({ memberships: { data: { id: 'row' } } });
    expect(await scopedMembershipExists(admin, 'team', 'team-1', ['a', 'b'])).toBe(true);
    expect(calls[0].filters).toMatchObject({
      scope_type: 'team',
      scope_id: 'team-1',
      profile_id: ['a', 'b'],
    });
  });

  it('empty profiles → false without a query; missing table → false', async () => {
    const { admin, calls } = mockAdmin({});
    expect(await scopedMembershipExists(admin, 'division', 'd', [])).toBe(false);
    expect(calls).toHaveLength(0);
    const { admin: admin2 } = mockAdmin({ memberships: { error: { code: '42P01' } } });
    expect(await scopedMembershipExists(admin2, 'division', 'd', ['a'])).toBe(false);
  });
});

describe('scopedMemberProfileIds', () => {
  it('dedupes and filters by scope', async () => {
    const { admin, calls } = mockAdmin({
      memberships: { data: [{ profile_id: 'a' }, { profile_id: 'a' }, { profile_id: 'b' }] },
    });
    const { profileIds, error } = await scopedMemberProfileIds(admin, 'division', 'div-1');
    expect(error).toBeNull();
    expect(profileIds).toEqual(['a', 'b']);
    expect(calls[0].filters).toMatchObject({ scope_type: 'division', scope_id: 'div-1' });
  });
});
