import { describe, it, expect } from 'vitest';
import {
  capabilitiesFromRows,
  capabilityAllows,
  getOrgRole,
  getOrgAndRole,
  hasAnyCapability,
  isOwnerOrManager,
  maxOrgRole,
  NO_CAPABILITIES,
  ORG_SECTIONS,
  roleAllows,
  visibleSections,
  type OrgCapabilities,
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
    manage_competitions: [true, true, false, false],
    manage_registration: [true, true, false, false],
    // Org staff program (178): the per-section intents are ladder
    // owner-or-manager like their siblings; only capabilityAllows widens them.
    manage_site: [true, true, false, false],
    manage_membership: [true, true, false, false],
    manage_structure: [true, true, false, false],
    manage_teams: [true, true, false, false],
    manage_affiliations: [true, true, false, false],
    manage_venues: [true, true, false, false],
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

describe('capabilitiesFromRows (178)', () => {
  const NOW = new Date('2026-09-04T12:00:00Z');

  it('follow rows feed the ladder; a scoped follow role never leaks into it', () => {
    const caps = capabilitiesFromRows([
      { role: 'member', kind: 'follow', scope_type: 'org' },
      { role: 'manager', kind: 'roster', scope_type: 'team', scope_id: 't1' },
    ], NOW);
    expect(caps.role).toBe('member');
    expect(caps.admin).toBe(false);
    expect(caps.sections).toEqual([]);
    expect(caps.scoped).toEqual([]);
  });

  it('staff rows: admin at org scope, sections at org scope, scoped grants merged per scope', () => {
    const caps = capabilitiesFromRows([
      { role: 'staff', kind: 'staff', scope_type: 'org', sections: ['teams', 'website'] },
      { role: 'staff', kind: 'staff', scope_type: 'division', scope_id: 'd1', sections: ['competitions'] },
      { role: 'staff', kind: 'staff', scope_type: 'division', scope_id: 'd1', sections: ['teams', 'competitions'] },
      { role: 'staff', kind: 'staff', scope_type: 'team', scope_id: 't1', sections: ['roster'] },
    ], NOW);
    expect(caps.role).toBeNull();
    expect(caps.sections).toEqual(['website', 'teams']); // ORG_SECTIONS order
    expect(caps.scoped).toEqual([
      { scopeType: 'division', scopeId: 'd1', sections: ['competitions', 'teams'] },
      { scopeType: 'team', scopeId: 't1', sections: ['roster'] },
    ]);
    expect(capabilitiesFromRows([{ role: 'admin', kind: 'staff', scope_type: 'org' }], NOW).admin).toBe(true);
    // admin is org-scope only — a stray scoped admin row grants nothing.
    expect(capabilitiesFromRows([{ role: 'admin', kind: 'staff', scope_type: 'team', scope_id: 't1' }], NOW)).toEqual(NO_CAPABILITIES);
  });

  it('expired rows, unknown sections and unknown roles are inert', () => {
    const caps = capabilitiesFromRows([
      { role: 'staff', kind: 'staff', scope_type: 'org', sections: ['teams'], expires_at: '2026-09-04T11:59:59Z' },
      { role: 'staff', kind: 'staff', scope_type: 'org', sections: ['payments'] },
      { role: 'convener', kind: 'staff', scope_type: 'org', sections: ['teams'] },
      { role: 'staff', kind: 'staff', scope_type: 'org', sections: ['venues'], expires_at: '2026-09-05T00:00:00Z' },
    ], NOW);
    expect(caps.sections).toEqual(['venues']);
    expect(hasAnyCapability(caps)).toBe(true);
    expect(hasAnyCapability(NO_CAPABILITIES)).toBe(false);
    expect(hasAnyCapability({ ...NO_CAPABILITIES, role: 'member' })).toBe(false);
  });
});

describe('capabilityAllows (178)', () => {
  const owner: OrgCapabilities = { ...NO_CAPABILITIES, role: 'owner' };
  const manager: OrgCapabilities = { ...NO_CAPABILITIES, role: 'manager' };
  const admin: OrgCapabilities = { ...NO_CAPABILITIES, admin: true };
  const allNine: OrgCapabilities = { ...NO_CAPABILITIES, sections: [...ORG_SECTIONS] };
  const teamsOnly: OrgCapabilities = { ...NO_CAPABILITIES, sections: ['teams'] };
  const divTeams: OrgCapabilities = {
    ...NO_CAPABILITIES,
    scoped: [{ scopeType: 'division', scopeId: 'd1', sections: ['teams'] }],
  };
  const member: OrgCapabilities = { ...NO_CAPABILITIES, role: 'member' };
  const SECTION_INTENTS: OrgIntent[] = [
    'manage_site', 'manage_members', 'manage_membership', 'manage_structure', 'manage_teams',
    'manage_competitions', 'schedule_events', 'manage_registration', 'manage_affiliations', 'manage_venues',
  ];

  it('ladder and admin pass every section intent; only the owner changes roles/owners', () => {
    for (const intent of SECTION_INTENTS) {
      expect(capabilityAllows(owner, intent), intent).toBe(true);
      expect(capabilityAllows(manager, intent), intent).toBe(true);
      expect(capabilityAllows(admin, intent), intent).toBe(true);
      expect(capabilityAllows(member, intent), intent).toBe(false);
    }
    expect(capabilityAllows(owner, 'change_roles')).toBe(true);
    expect(capabilityAllows(manager, 'change_roles')).toBe(false);
    expect(capabilityAllows(admin, 'change_roles')).toBe(false);
    expect(capabilityAllows(admin, 'manage_owners')).toBe(false);
  });

  it('manage_org is never reached by section grants — nine ticked boxes is not admin', () => {
    expect(capabilityAllows(allNine, 'manage_org')).toBe(false);
    expect(capabilityAllows(allNine, 'change_roles')).toBe(false);
    expect(capabilityAllows(admin, 'manage_org')).toBe(true);
    for (const intent of SECTION_INTENTS) expect(capabilityAllows(allNine, intent), intent).toBe(true);
  });

  it('an org-wide section grant passes only its own section', () => {
    expect(capabilityAllows(teamsOnly, 'manage_teams')).toBe(true);
    expect(capabilityAllows(teamsOnly, 'manage_structure')).toBe(false);
    expect(capabilityAllows(teamsOnly, 'manage_site')).toBe(false);
    expect(capabilityAllows(teamsOnly, 'manage_org')).toBe(false);
  });

  it('a scoped grant passes its own scope and its child teams, never the org level or a sibling', () => {
    expect(capabilityAllows(divTeams, 'manage_teams')).toBe(false); // org-level write
    expect(capabilityAllows(divTeams, 'manage_teams', { type: 'division', id: 'd1' })).toBe(true);
    expect(capabilityAllows(divTeams, 'manage_teams', { type: 'division', id: 'd2' })).toBe(false);
    expect(capabilityAllows(divTeams, 'manage_teams', { type: 'team', id: 't1', parentDivisionIds: ['d1'] })).toBe(true);
    expect(capabilityAllows(divTeams, 'manage_teams', { type: 'team', id: 't1', parentDivisionIds: ['d9'] })).toBe(false);
    expect(capabilityAllows(divTeams, 'manage_teams', { type: 'team', id: 't1' })).toBe(false);
    expect(capabilityAllows(divTeams, 'manage_competitions', { type: 'division', id: 'd1' })).toBe(false);
    // a team grant never climbs to its division
    const teamGrant: OrgCapabilities = { ...NO_CAPABILITIES, scoped: [{ scopeType: 'team', scopeId: 't1', sections: ['roster'] }] };
    expect(capabilityAllows(teamGrant, 'manage_members', { type: 'team', id: 't1' })).toBe(true);
    expect(capabilityAllows(teamGrant, 'manage_members', { type: 'division', id: 'd1' })).toBe(false);
  });

  it('visibleSections: everything for ladder/admin, the union for staff', () => {
    expect(visibleSections(owner)).toEqual([...ORG_SECTIONS]);
    expect(visibleSections(admin)).toEqual([...ORG_SECTIONS]);
    expect(visibleSections({ ...teamsOnly, scoped: [{ scopeType: 'division', scopeId: 'd1', sections: ['venues'] }] })).toEqual(['teams', 'venues']);
    expect(visibleSections(member)).toEqual([]);
  });
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
