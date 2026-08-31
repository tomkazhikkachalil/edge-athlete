import { describe, it, expect } from 'vitest';
import {
  getOrgRole,
  getOrgAndRole,
  isOwnerOrManager,
  maxOrgRole,
  roleAllows,
  type OrgIntent,
  type OrgRole,
} from '../authz';

type Admin = Parameters<typeof getOrgRole>[0];

type MockResult = { data: unknown; error: { code: string } | null };

/** Minimal chain mock: the builder is thenable (role reads await the eq
 *  chain directly since the multi-row change) and still offers maybeSingle
 *  for the org-row fetch; records which tables were queried so the
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
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
  return { admin: admin as unknown as Admin, queried };
}

describe('maxOrgRole', () => {
  it('reduces to the highest role, order-free', () => {
    expect(maxOrgRole([])).toBeNull();
    expect(maxOrgRole(['member'])).toBe('member');
    expect(maxOrgRole(['member', 'manager'])).toBe('manager');
    expect(maxOrgRole(['manager', 'member'])).toBe('manager');
    expect(maxOrgRole(['member', 'owner', 'manager'])).toBe('owner');
    expect(maxOrgRole(['garbage', null, undefined])).toBeNull();
    expect(maxOrgRole(['garbage', 'member'])).toBe('member');
  });
});

describe('getOrgRole (rows-first since 0.8)', () => {
  it('reads the rows even on an owner-column match', async () => {
    const { admin, queried } = mockAdmin({
      memberships: { data: [{ role: 'owner' }], error: null },
    });
    const role = await getOrgRole(admin, 'league', 'org-1', 'me');
    expect(role).toBe('owner');
    expect(queried).toEqual(['memberships']);
  });

  it('zero rows + column match → null (the soak fallback is GONE — the cache grants nothing)', async () => {
    const { admin, queried } = mockAdmin({ memberships: { data: [], error: null } });
    const role = await getOrgRole(admin, 'league', 'org-1', 'me');
    expect(role).toBeNull();
    expect(queried).toEqual(['memberships']);
  });

  it('a stale cache can NEVER resurrect a stepped-down owner', async () => {
    // The stepped-down primary holds a manager row; the column still names
    // them. Rows win.
    const { admin } = mockAdmin({
      memberships: { data: [{ role: 'manager' }], error: null },
    });
    expect(await getOrgRole(admin, 'league', 'org-1', 'me')).toBe('manager');
  });

  it('reduces multiple rows (follow + roster) to the max role', async () => {
    const { admin, queried } = mockAdmin({
      memberships: { data: [{ role: 'member' }, { role: 'manager' }], error: null },
    });
    const role = await getOrgRole(admin, 'club', 'org-1', 'me');
    expect(role).toBe('manager');
    expect(queried).toEqual(['memberships']);
  });

  it('returns null for a non-member (and for a null owner column)', async () => {
    const { admin } = mockAdmin({});
    expect(await getOrgRole(admin, 'league', 'org-1', 'me')).toBeNull();
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
    manage_owners: [true, false, false, false],
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
      memberships: { data: [{ role: 'member' }], error: null },
    });
    const out = await getOrgAndRole(admin, 'club', 'org-1', 'me');
    expect(out).toEqual({ status: 'found', org: ORG, role: 'member' });
  });

  it('found: the cached owner with no rows resolves to NO role (rows-only)', async () => {
    // memberships resolves empty here — post-cleanup the cache grants
    // nothing; a real owner always holds their insertOwnerRow row.
    const { admin, queried } = mockAdmin({
      leagues: { data: ORG, error: null },
    });
    const out = await getOrgAndRole(admin, 'league', 'org-1', 'owner-1');
    expect(out).toEqual({ status: 'found', org: ORG, role: null });
    expect(queried).toEqual(['leagues', 'memberships']);
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
