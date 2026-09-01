import { describe, expect, it } from 'vitest';
import type { User } from '@supabase/supabase-js';
import {
  divisionCreatePOST,
  divisionDELETE,
  entryCreatePOST,
  entryDELETE,
  requireOrgManager,
  seasonDELETE,
  structureAggregateGET,
  teamPATCH,
} from '../structure-server';

type Admin = Parameters<typeof requireOrgManager>[0];

const USER = { id: 'user-1' } as User;

interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
  filters: Record<string, unknown>;
}

/** Chain mock in the house style: results keyed by table; repeated reads of
 *  one table can pass an ARRAY of results consumed in order. Records ops +
 *  filters so scope pinning is assertable. */
function mockAdmin(
  results: Partial<Record<string, unknown>>
) {
  const calls: RecordedCall[] = [];
  const consumed: Record<string, number> = {};
  const admin = {
    from(table: string) {
      const call: RecordedCall = { table, op: 'select', filters: {} };
      calls.push(call);
      const entry = results[table];
      const result = Array.isArray(entry)
        ? { data: null, error: null, ...((entry[consumed[table] = (consumed[table] ?? 0)] as object) ?? {}) }
        : { data: null, error: null, ...((entry as object) ?? {}) };
      if (Array.isArray(entry)) consumed[table]++;
      const chain = {
        eq(col: string, val: unknown) {
          call.filters[col] = val;
          return chain;
        },
        in(col: string, vals: unknown) {
          call.filters[col] = vals;
          return chain;
        },
        order: () => chain,
        select: () => chain,
        single: async () => result,
        maybeSingle: async () => result,
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return {
        select: () => chain,
        insert(payload: unknown) {
          call.op = 'insert';
          call.payload = payload;
          return chain;
        },
        update(payload: unknown) {
          call.op = 'update';
          call.payload = payload;
          return chain;
        },
        delete() {
          call.op = 'delete';
          return chain;
        },
      };
    },
  };
  return { admin: admin as unknown as Admin, calls };
}

const SCOPE = { side: 'league' as const, orgId: 'org-1' };

describe('requireOrgManager', () => {
  it('manager/owner pass; member and null 403; missing org 404; error 500', async () => {
    const ok = mockAdmin({
      leagues: { data: { id: 'org-1', name: 'L', owner_profile_id: null } },
      memberships: { data: [{ role: 'manager' }] },
    });
    const passed = await requireOrgManager(ok.admin, USER, 'league', 'org-1');
    expect(passed.ok).toBe(true);

    const member = mockAdmin({
      leagues: { data: { id: 'org-1', name: 'L', owner_profile_id: null } },
      memberships: { data: [{ role: 'member' }] },
    });
    const denied = await requireOrgManager(member.admin, USER, 'league', 'org-1');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(403);

    const missing = mockAdmin({ clubs: { data: null } });
    const notFound = await requireOrgManager(missing.admin, USER, 'club', 'org-1');
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.response.status).toBe(404);

    const broken = mockAdmin({ leagues: { data: null, error: { code: '57014' } } });
    const errored = await requireOrgManager(broken.admin, USER, 'league', 'org-1');
    expect(errored.ok).toBe(false);
    if (!errored.ok) expect(errored.response.status).toBe(500);
  });
});

describe('scope pinning — the security crux', () => {
  it('seasonDELETE scoped pins the org column; zero rows → 404', async () => {
    const { admin, calls } = mockAdmin({ seasons: { data: [] } });
    const res = await seasonDELETE(admin, 'season-1', SCOPE);
    expect(res.status).toBe(404);
    expect(calls[0]).toMatchObject({
      table: 'seasons',
      op: 'delete',
      filters: { id: 'season-1', league_id: 'org-1' },
    });
  });

  it('seasonDELETE unscoped (admin) has no org filter', async () => {
    const { admin, calls } = mockAdmin({ seasons: { data: [{ id: 's', league_id: null }] } });
    const res = await seasonDELETE(admin, 'season-1', null);
    expect(res.status).toBe(200);
    expect('league_id' in calls[0].filters).toBe(false);
  });

  it('divisionCreatePOST scoped 404s a foreign-org season', async () => {
    const { admin } = mockAdmin({
      seasons: { data: { id: 's1', league_id: 'OTHER-org', club_id: null } },
    });
    const res = await divisionCreatePOST(
      admin,
      { seasonId: 's1', sportKey: 'golf', name: 'Open' },
      SCOPE
    );
    expect(res.status).toBe(404);
  });

  it('divisionDELETE + teamPATCH scoped pin the org column', async () => {
    const d = mockAdmin({ divisions: { data: [] } });
    expect((await divisionDELETE(d.admin, 'div-1', SCOPE)).status).toBe(404);
    expect(d.calls[0].filters).toMatchObject({ id: 'div-1', league_id: 'org-1' });

    const t = mockAdmin({ teams: { data: [] } });
    expect((await teamPATCH(t.admin, { id: 'team-1', status: 'archived' }, SCOPE)).status).toBe(404);
    expect(t.calls[0].filters).toMatchObject({ id: 'team-1', league_id: 'org-1' });
  });

  it('entryCreatePOST scoped 404s foreign rows; cross-org 400; archived 400', async () => {
    const foreign = mockAdmin({
      teams: { data: { id: 't', league_id: 'OTHER', club_id: null, status: 'active' } },
      divisions: { data: { id: 'd', league_id: 'org-1', club_id: null } },
    });
    expect(
      (await entryCreatePOST(foreign.admin, { teamId: 't', divisionId: 'd' }, SCOPE)).status
    ).toBe(404);

    const crossOrg = mockAdmin({
      teams: { data: { id: 't', league_id: 'a', club_id: null, status: 'active' } },
      divisions: { data: { id: 'd', league_id: 'b', club_id: null } },
    });
    expect(
      (await entryCreatePOST(crossOrg.admin, { teamId: 't', divisionId: 'd' }, null)).status
    ).toBe(400);

    const archived = mockAdmin({
      teams: { data: { id: 't', league_id: 'a', club_id: null, status: 'archived' } },
      divisions: { data: { id: 'd', league_id: 'a', club_id: null } },
    });
    expect(
      (await entryCreatePOST(archived.admin, { teamId: 't', divisionId: 'd' }, null)).status
    ).toBe(400);
  });

  it('entryDELETE scoped verifies through the DIVISION JOIN (no org column)', async () => {
    const foreign = mockAdmin({
      team_entries: { data: { id: 'e1', division: { league_id: 'OTHER', club_id: null } } },
    });
    expect((await entryDELETE(foreign.admin, 'e1', SCOPE)).status).toBe(404);
    expect(foreign.calls[0].op).toBe('select');

    const ok = mockAdmin({
      team_entries: [
        { data: { id: 'e1', division: { league_id: 'org-1', club_id: null } } },
        { data: [{ id: 'e1' }] },
      ],
    });
    expect((await entryDELETE(ok.admin, 'e1', SCOPE)).status).toBe(200);
    expect(ok.calls[1].op).toBe('delete');
  });
});

describe('structureAggregateGET', () => {
  it('pre-145 (missing table) degrades to an empty console', async () => {
    const { admin } = mockAdmin({ seasons: { data: null, error: { code: '42P01' } } });
    const res = await structureAggregateGET(admin, SCOPE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seasons: [], teams: [] });
  });

  it('includeCounts adds the two membership head-counts', async () => {
    const { admin, calls } = mockAdmin({
      seasons: { data: [] },
      teams: { data: [] },
      memberships: { data: null },
    });
    const res = await structureAggregateGET(admin, SCOPE, { includeCounts: true });
    const body = await res.json();
    expect(body.counts).toEqual({ managers: 0, rosterAthletes: 0 });
    const membershipCalls = calls.filter(c => c.table === 'memberships');
    expect(membershipCalls[0].filters).toMatchObject({
      league_id: 'org-1',
      scope_type: 'org',
      kind: 'follow',
      role: ['owner', 'manager'],
    });
    expect(membershipCalls[1].filters).toMatchObject({
      league_id: 'org-1',
      kind: 'roster',
      // Phase 5 R1 fix: org-scope pin + on-the-roster semantics.
      scope_type: 'org',
      status: ['active', 'placed'],
    });
  });
});
