import { describe, expect, it } from 'vitest';
import { hasEventScope, resolveEventScope } from '../event-scope';

type Admin = Parameters<typeof resolveEventScope>[0];

function mockAdmin(results: Partial<Record<string, { data?: unknown; error?: { code: string } | null }>>) {
  const calls: { table: string; filters: Record<string, unknown> }[] = [];
  const admin = {
    from(table: string) {
      const call = { table, filters: {} as Record<string, unknown> };
      calls.push(call);
      const result = { data: null, error: null, ...(results[table] ?? {}) };
      const chain = {
        eq(col: string, val: unknown) {
          call.filters[col] = val;
          return chain;
        },
        select: () => chain,
        maybeSingle: async () => result,
      };
      return { select: () => chain };
    },
  };
  return { admin: admin as unknown as Admin, calls };
}

describe('hasEventScope', () => {
  it('true for any of the four scope columns', () => {
    expect(hasEventScope({})).toBe(false);
    expect(hasEventScope({ league_id: 'x' })).toBe(true);
    expect(hasEventScope({ division_id: 'x' })).toBe(true);
    expect(hasEventScope({ team_id: 'x' })).toBe(true);
  });
});

describe('resolveEventScope', () => {
  it('org scopes resolve without a structure read', async () => {
    const { admin, calls } = mockAdmin({});
    expect(await resolveEventScope(admin, { league_id: 'lg-1' })).toEqual({
      scopeType: 'org',
      side: 'league',
      orgId: 'lg-1',
      scopeId: null,
    });
    expect(await resolveEventScope(admin, { club_id: 'cl-1' })).toMatchObject({ side: 'club', orgId: 'cl-1' });
    expect(calls).toHaveLength(0);
  });

  it('division scope resolves through the divisions row', async () => {
    const { admin, calls } = mockAdmin({
      divisions: { data: { id: 'div-1', league_id: 'lg-1', club_id: null } },
    });
    expect(await resolveEventScope(admin, { division_id: 'div-1' })).toEqual({
      scopeType: 'division',
      side: 'league',
      orgId: 'lg-1',
      scopeId: 'div-1',
    });
    expect(calls[0]).toMatchObject({ table: 'divisions', filters: { id: 'div-1' } });
  });

  it('team scope resolves through the teams row (club side)', async () => {
    const { admin } = mockAdmin({ teams: { data: { id: 't-1', league_id: null, club_id: 'cl-1' } } });
    expect(await resolveEventScope(admin, { team_id: 't-1' })).toEqual({
      scopeType: 'team',
      side: 'club',
      orgId: 'cl-1',
      scopeId: 't-1',
    });
  });

  it('unscoped or dangling scope → null (degrade, never throw)', async () => {
    const { admin } = mockAdmin({ divisions: { data: null } });
    expect(await resolveEventScope(admin, {})).toBeNull();
    expect(await resolveEventScope(admin, { division_id: 'gone' })).toBeNull();
    const { admin: admin2 } = mockAdmin({ teams: { error: { code: '42P01' } } });
    expect(await resolveEventScope(admin2, { team_id: 't' })).toBeNull();
  });
});
