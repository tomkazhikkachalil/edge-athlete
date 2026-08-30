import { describe, it, expect } from 'vitest';
import {
  getOrgRole,
  getOrgAndRole,
  isOwnerOrManager,
  roleAllows,
  type OrgIntent,
  type OrgRole,
} from '../authz';

type Admin = Parameters<typeof getOrgRole>[0];

type MockResult = { data: unknown; error: { code: string } | null };

/** Minimal chain mock: from(...).select(...).eq(...)...maybeSingle() resolves
 *  the canned result for the table; records which tables were queried so the
 *  owner-column short-circuit is assertable. */
function mockAdmin(results: Partial<Record<string, MockResult>>) {
  const queried: string[] = [];
  const admin = {
    from(table: string) {
      queried.push(table);
      const result = results[table] ?? { data: null, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => result,
      };
      return builder;
    },
  };
  return { admin: admin as unknown as Admin, queried };
}

describe('getOrgRole', () => {
  it('owner column short-circuits without touching the members table', async () => {
    const { admin, queried } = mockAdmin({});
    const role = await getOrgRole(admin, 'league_members', 'org-1', 'me', 'me');
    expect(role).toBe('owner');
    expect(queried).toEqual([]);
  });

  it('falls back to the member row role when the owner column is someone else', async () => {
    const { admin, queried } = mockAdmin({
      club_members: { data: { role: 'manager' }, error: null },
    });
    const role = await getOrgRole(admin, 'club_members', 'org-1', 'me', 'someone-else');
    expect(role).toBe('manager');
    expect(queried).toEqual(['club_members']);
  });

  it('returns null for a non-member (and for a null owner column)', async () => {
    const { admin } = mockAdmin({});
    expect(await getOrgRole(admin, 'league_members', 'org-1', 'me', null)).toBeNull();
  });
});

describe('roleAllows', () => {
  const ROLES: (OrgRole | null)[] = ['owner', 'manager', 'member', null];
  const EXPECTED: Record<OrgIntent, boolean[]> = {
    // per role in ROLES order: owner, manager, member, null
    manage_org: [true, true, false, false],
    manage_members: [true, true, false, false],
    schedule_events: [true, true, false, false],
    change_roles: [true, false, false, false],
  };

  for (const [intent, expected] of Object.entries(EXPECTED) as [OrgIntent, boolean[]][]) {
    it(`${intent}: ${expected.filter(Boolean).length === 1 ? 'owner only' : 'owner or manager'}`, () => {
      ROLES.forEach((role, i) => {
        expect(roleAllows(role, intent)).toBe(expected[i]);
      });
    });
  }
});

describe('isOwnerOrManager', () => {
  it('owner and manager pass; member and null do not', () => {
    expect(isOwnerOrManager('owner')).toBe(true);
    expect(isOwnerOrManager('manager')).toBe(true);
    expect(isOwnerOrManager('member')).toBe(false);
    expect(isOwnerOrManager(null)).toBe(false);
  });
});

describe('getOrgAndRole', () => {
  const ORG = { id: 'org-1', name: 'Kanata GC', owner_profile_id: 'owner-1' };

  it('found: returns the org row and the resolved role', async () => {
    const { admin } = mockAdmin({
      clubs: { data: ORG, error: null },
      club_members: { data: { role: 'member' }, error: null },
    });
    const out = await getOrgAndRole(admin, 'club', 'org-1', 'me');
    expect(out).toEqual({ status: 'found', org: ORG, role: 'member' });
  });

  it('found: the owner-column match yields owner without a members query', async () => {
    const { admin, queried } = mockAdmin({
      leagues: { data: ORG, error: null },
    });
    const out = await getOrgAndRole(admin, 'league', 'org-1', 'owner-1');
    expect(out).toEqual({ status: 'found', org: ORG, role: 'owner' });
    expect(queried).toEqual(['leagues']);
  });

  it('not_found: missing row', async () => {
    const { admin } = mockAdmin({ leagues: { data: null, error: null } });
    expect(await getOrgAndRole(admin, 'league', 'org-1', 'me')).toEqual({ status: 'not_found' });
  });

  it('not_found: pre-migration missing-table codes (42P01 / PGRST205)', async () => {
    for (const code of ['42P01', 'PGRST205']) {
      const { admin } = mockAdmin({ clubs: { data: null, error: { code } } });
      expect(await getOrgAndRole(admin, 'club', 'org-1', 'me')).toEqual({ status: 'not_found' });
    }
  });

  it('error: any other fetch error passes through for the route to log', async () => {
    const failure = { code: '57014' };
    const { admin } = mockAdmin({ leagues: { data: null, error: failure } });
    expect(await getOrgAndRole(admin, 'league', 'org-1', 'me')).toEqual({
      status: 'error',
      error: failure,
    });
  });
});
