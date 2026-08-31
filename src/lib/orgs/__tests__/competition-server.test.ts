import { describe, expect, it } from 'vitest';
import type { User } from '@supabase/supabase-js';
import {
  competitionCreatePOST,
  competitionPATCH,
  competitionsAggregateGET,
  entryAddPOST,
  entryDELETE,
  requireCompetitionManager,
} from '../competition-server';

type Admin = Parameters<typeof requireCompetitionManager>[0];

const USER = { id: 'user-1' } as User;

interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
  filters: Record<string, unknown>;
}

/** The structure-server chain mock, plus .limit() (the roster read uses it). */
function mockAdmin(results: Partial<Record<string, unknown>>) {
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
        limit: () => chain,
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

describe('requireCompetitionManager', () => {
  it('manager passes; member 403; missing org 404; error 500', async () => {
    const ok = mockAdmin({
      leagues: { data: { id: 'org-1', name: 'L', owner_profile_id: null } },
      memberships: { data: [{ role: 'manager' }] },
    });
    expect((await requireCompetitionManager(ok.admin, USER, 'league', 'org-1')).ok).toBe(true);

    const member = mockAdmin({
      leagues: { data: { id: 'org-1', name: 'L', owner_profile_id: null } },
      memberships: { data: [{ role: 'member' }] },
    });
    const denied = await requireCompetitionManager(member.admin, USER, 'league', 'org-1');
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.response.status).toBe(403);

    const missing = mockAdmin({ clubs: { data: null } });
    const notFound = await requireCompetitionManager(missing.admin, USER, 'club', 'org-1');
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.response.status).toBe(404);

    const broken = mockAdmin({ leagues: { data: null, error: { code: '57014' } } });
    const errored = await requireCompetitionManager(broken.admin, USER, 'league', 'org-1');
    expect(errored.ok).toBe(false);
    if (!errored.ok) expect(errored.response.status).toBe(500);
  });
});

describe('competitionCreatePOST', () => {
  it('404s a foreign-org season (scope is the security crux)', async () => {
    const { admin } = mockAdmin({
      seasons: { data: { id: 's1', league_id: 'OTHER-org', club_id: null } },
    });
    const res = await competitionCreatePOST(admin, SCOPE, {
      side: 'league',
      orgId: 'org-1',
      seasonId: 's1',
      sportKey: 'ice_hockey',
      name: 'House League',
      format: 'fixture',
      visibility: 'private',
    });
    expect(res.status).toBe(404);
  });

  it('404s a division outside the season', async () => {
    const { admin } = mockAdmin({
      seasons: { data: { id: 's1', league_id: 'org-1', club_id: null } },
      divisions: { data: { id: 'd1', season_id: 'OTHER-season' } },
    });
    const res = await competitionCreatePOST(admin, SCOPE, {
      side: 'league',
      orgId: 'org-1',
      seasonId: 's1',
      divisionId: 'd1',
      sportKey: 'ice_hockey',
      name: 'House League',
      format: 'fixture',
      visibility: 'private',
    });
    expect(res.status).toBe(404);
  });

  it('inherits the org from the season and DERIVES entrant_type from format', async () => {
    const { admin, calls } = mockAdmin({
      seasons: { data: { id: 's1', league_id: 'org-1', club_id: null } },
      competitions: { data: { id: 'c1' } },
    });
    const res = await competitionCreatePOST(admin, SCOPE, {
      side: 'league',
      orgId: 'org-1',
      seasonId: 's1',
      sportKey: 'ice_hockey',
      name: 'House League',
      format: 'fixture',
      visibility: 'public',
    });
    expect(res.status).toBe(200);
    const insert = calls.find(c => c.table === 'competitions');
    expect(insert?.payload).toMatchObject({
      league_id: 'org-1',
      club_id: null,
      format: 'fixture',
      entrant_type: 'team',
      visibility: 'public',
    });
  });

  it('23505 maps to 409', async () => {
    const { admin } = mockAdmin({
      seasons: { data: { id: 's1', league_id: 'org-1', club_id: null } },
      competitions: { data: null, error: { code: '23505' } },
    });
    const res = await competitionCreatePOST(admin, SCOPE, {
      side: 'league',
      orgId: 'org-1',
      seasonId: 's1',
      sportKey: 'ice_hockey',
      name: 'House League',
      format: 'fixture',
      visibility: 'private',
    });
    expect(res.status).toBe(409);
  });
});

describe('competitionPATCH scope pinning', () => {
  it('scoped pins the org column; zero rows → 404', async () => {
    const { admin, calls } = mockAdmin({ competitions: { data: [] } });
    const res = await competitionPATCH(admin, { id: 'c1', status: 'active' }, SCOPE);
    expect(res.status).toBe(404);
    expect(calls[0]).toMatchObject({
      table: 'competitions',
      op: 'update',
      filters: { id: 'c1', league_id: 'org-1' },
    });
  });
});

describe('entryAddPOST', () => {
  const comp = {
    id: 'c1',
    league_id: 'org-1',
    club_id: null,
    division_id: null,
    entrant_type: 'team',
    status: 'active',
  };

  it('404s a foreign-org competition when scoped', async () => {
    const { admin } = mockAdmin({ competitions: { data: { ...comp, league_id: 'OTHER' } } });
    const res = await entryAddPOST(admin, { competitionId: 'c1', teamId: 't1' }, SCOPE);
    expect(res.status).toBe(404);
  });

  it('closed competitions refuse entries', async () => {
    const { admin } = mockAdmin({ competitions: { data: { ...comp, status: 'completed' } } });
    const res = await entryAddPOST(admin, { competitionId: 'c1', teamId: 't1' }, SCOPE);
    expect(res.status).toBe(400);
  });

  it('entrant kind must match entrant_type', async () => {
    const { admin } = mockAdmin({ competitions: { data: comp } });
    const res = await entryAddPOST(admin, { competitionId: 'c1', profileId: 'p1' }, SCOPE);
    expect(res.status).toBe(400);
  });

  it('team path: foreign-org team 404s; archived team 400s (v1 own-org rule)', async () => {
    const foreign = mockAdmin({
      competitions: { data: comp },
      teams: { data: { id: 't1', league_id: 'OTHER', club_id: null, status: 'active' } },
    });
    expect((await entryAddPOST(foreign.admin, { competitionId: 'c1', teamId: 't1' }, SCOPE)).status).toBe(404);

    const archived = mockAdmin({
      competitions: { data: comp },
      teams: { data: { id: 't1', league_id: 'org-1', club_id: null, status: 'archived' } },
    });
    expect((await entryAddPOST(archived.admin, { competitionId: 'c1', teamId: 't1' }, SCOPE)).status).toBe(400);
  });

  it('division-pinned competition requires a team_entry in that division', async () => {
    const { admin } = mockAdmin({
      competitions: { data: { ...comp, division_id: 'd1' } },
      teams: { data: { id: 't1', league_id: 'org-1', club_id: null, status: 'active' } },
      team_entries: { data: null },
    });
    const res = await entryAddPOST(admin, { competitionId: 'c1', teamId: 't1' }, SCOPE);
    expect(res.status).toBe(400);
  });

  it('athlete path requires an ACTIVE ROSTER row (§8 invariant 3 — never follow)', async () => {
    const athleteComp = { ...comp, entrant_type: 'athlete' };
    const noRoster = mockAdmin({
      competitions: { data: athleteComp },
      memberships: { data: null },
    });
    expect(
      (await entryAddPOST(noRoster.admin, { competitionId: 'c1', profileId: 'p1' }, SCOPE)).status
    ).toBe(400);

    const rostered = mockAdmin({
      competitions: { data: athleteComp },
      memberships: { data: { id: 'm1' } },
      competition_entries: { data: { id: 'e1' } },
    });
    const res = await entryAddPOST(rostered.admin, { competitionId: 'c1', profileId: 'p1' }, SCOPE);
    expect(res.status).toBe(200);
    const rosterRead = rostered.calls.find(c => c.table === 'memberships');
    expect(rosterRead?.filters).toMatchObject({
      league_id: 'org-1',
      profile_id: 'p1',
      kind: 'roster',
      status: 'active',
    });
  });

  it('duplicate entry 23505 → 409', async () => {
    const { admin } = mockAdmin({
      competitions: { data: comp },
      teams: { data: { id: 't1', league_id: 'org-1', club_id: null, status: 'active' } },
      competition_entries: { data: null, error: { code: '23505' } },
    });
    const res = await entryAddPOST(admin, { competitionId: 'c1', teamId: 't1' }, SCOPE);
    expect(res.status).toBe(409);
  });
});

describe('entryDELETE', () => {
  it('scoped verifies through the COMPETITION JOIN (no org column)', async () => {
    const foreign = mockAdmin({
      competition_entries: { data: { id: 'e1', competition: { league_id: 'OTHER', club_id: null } } },
    });
    expect((await entryDELETE(foreign.admin, 'e1', SCOPE)).status).toBe(404);
    expect(foreign.calls[0].op).toBe('select');

    const ok = mockAdmin({
      competition_entries: [
        { data: { id: 'e1', competition: { league_id: 'org-1', club_id: null } } },
        { data: [{ id: 'e1' }] },
      ],
    });
    expect((await entryDELETE(ok.admin, 'e1', SCOPE)).status).toBe(200);
    expect(ok.calls[1].op).toBe('delete');
  });
});

describe('competitionsAggregateGET', () => {
  it('pre-151 (missing table) degrades to an empty list', async () => {
    const { admin } = mockAdmin({ competitions: { data: null, error: { code: 'PGRST205' } } });
    const res = await competitionsAggregateGET(admin, SCOPE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ competitions: [] });
  });

  it('assembles entries with entrant display names', async () => {
    const { admin } = mockAdmin({
      competitions: {
        data: [
          {
            id: 'c1',
            season_id: 's1',
            division_id: null,
            sport_key: 'ice_hockey',
            name: 'House',
            format: 'fixture',
            entrant_type: 'team',
            scoring_rule: null,
            status: 'active',
            visibility: 'public',
            created_at: 'now',
          },
        ],
      },
      competition_entries: {
        data: [{ id: 'e1', competition_id: 'c1', team_id: 't1', profile_id: null, status: 'approved', seed: null, pool: null }],
      },
      teams: { data: [{ id: 't1', name: 'Blazers', display_name: null }] },
      seasons: { data: [{ id: 's1', label: '2026-27' }] },
    });
    const body = await (await competitionsAggregateGET(admin, SCOPE)).json();
    expect(body.competitions[0].season_label).toBe('2026-27');
    expect(body.competitions[0].entries[0].entrant_name).toBe('Blazers');
  });
});
