import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptRosterOffer,
  deleteRosterRow,
  getMemberRole,
  insertOwnerRow,
  insertRosterOffer,
  joinOrg,
  leaveOrg,
  memberCountsByOrg,
  memberOrgIds,
  membershipEdges,
  orgMemberPreview,
  profileMembershipRows,
  redactPendingRoster,
  removeMember,
  setMemberRole,
} from '../members';

type Admin = Parameters<typeof joinOrg>[0];

interface RecordedCall {
  table: string;
  op: 'insert' | 'update' | 'delete' | 'select' | '';
  payload?: unknown;
  filters: Record<string, unknown>;
}

/** Chain mock recording every from() call in order, with per-table canned
 *  results — the mechanical net for the dual-write contract, since no typed
 *  client exists to catch a wrong table or missing filter. */
function mockAdmin(
  results: Partial<Record<string, { data?: unknown; error: { code: string } | null }>>
) {
  const calls: RecordedCall[] = [];
  const admin = {
    from(table: string) {
      const call: RecordedCall = { table, op: '', filters: {} };
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
        order: () => chain,
        select: () => chain,
        maybeSingle: async () => result,
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return {
        insert(payload: unknown) {
          call.op = 'insert';
          call.payload = payload;
          return Promise.resolve(result);
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
        select() {
          call.op = call.op || 'select';
          return chain;
        },
      };
    },
  };
  return { admin: admin as unknown as Admin, calls };
}

const REF = { side: 'league' as const, orgId: 'org-1' };
const CLUB_REF = { side: 'club' as const, orgId: 'club-1' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('single-write to memberships', () => {
  it('joinOrg writes ONLY memberships and surfaces its error', async () => {
    const ok = mockAdmin({});
    const { error } = await joinOrg(ok.admin, REF, 'me');
    expect(error).toBeNull();
    expect(ok.calls.map(c => c.table)).toEqual(['memberships']);
    expect(ok.calls[0].payload).toEqual({ league_id: 'org-1', profile_id: 'me' });

    const failure = { code: '23503' };
    const bad = mockAdmin({ memberships: { error: failure } });
    expect((await joinOrg(bad.admin, REF, 'me')).error).toBe(failure);
  });

  it('insertOwnerRow carries role owner', async () => {
    const { admin, calls } = mockAdmin({});
    await insertOwnerRow(admin, CLUB_REF, 'owner-1');
    expect(calls.map(c => c.table)).toEqual(['memberships']);
    expect(calls[0].payload).toEqual({ club_id: 'club-1', profile_id: 'owner-1', role: 'owner' });
  });
});

describe('write filters keep legacy-shaped paths off future roster rows', () => {
  it('leaveOrg deletes BOTH kinds (exit ends roster participation)', async () => {
    const { admin, calls } = mockAdmin({});
    await leaveOrg(admin, REF, 'me');
    expect(calls).toHaveLength(1);
    expect(calls[0].table).toBe('memberships');
    expect(calls[0].op).toBe('delete');
    expect(calls[0].filters).toEqual({
      league_id: 'org-1',
      profile_id: 'me',
      kind: ['follow', 'roster'],
      scope_type: 'org',
    });
  });

  it('removeMember exits both kinds; setMemberRole touches only the follow row', async () => {
    const { admin, calls } = mockAdmin({});
    await removeMember(admin, CLUB_REF, 'them');
    await setMemberRole(admin, CLUB_REF, 'them', 'member');
    expect(calls.map(c => c.table)).toEqual(['memberships', 'memberships']);
    expect(calls[0].filters).toEqual({
      club_id: 'club-1',
      profile_id: 'them',
      kind: ['follow', 'roster'],
      scope_type: 'org',
    });
    expect(calls[1].op).toBe('update');
    expect(calls[1].payload).toEqual({ role: 'member' });
    expect(calls[1].filters).toEqual({
      club_id: 'club-1',
      profile_id: 'them',
      kind: 'follow',
      scope_type: 'org',
    });
  });

  it('roster writers carry explicit kind and never rely on defaults', async () => {
    const offer = mockAdmin({});
    await insertRosterOffer(offer.admin, REF, 'them');
    expect(offer.calls[0].op).toBe('insert');
    expect(offer.calls[0].payload).toEqual({
      league_id: 'org-1',
      profile_id: 'them',
      kind: 'roster',
      status: 'pending',
    });

    const accept = mockAdmin({ memberships: { data: [{ id: 'row-1' }], error: null } });
    const acceptRes = await acceptRosterOffer(accept.admin, REF, 'me');
    expect(acceptRes).toEqual({ accepted: true, error: null });
    expect(accept.calls[0].op).toBe('update');
    expect(accept.calls[0].payload).toEqual({ status: 'active' });
    expect(accept.calls[0].filters).toEqual({
      league_id: 'org-1',
      profile_id: 'me',
      kind: 'roster',
      status: 'pending',
      scope_type: 'org',
    });

    const noPending = mockAdmin({ memberships: { data: [], error: null } });
    expect((await acceptRosterOffer(noPending.admin, REF, 'me')).accepted).toBe(false);

    const del = mockAdmin({ memberships: { data: [{ id: 'row-1' }], error: null } });
    const delRes = await deleteRosterRow(del.admin, CLUB_REF, 'them');
    expect(delRes).toEqual({ deleted: true, error: null });
    expect(del.calls[0].op).toBe('delete');
    expect(del.calls[0].filters).toEqual({
      club_id: 'club-1',
      profile_id: 'them',
      kind: 'roster',
      scope_type: 'org',
    });
  });

  it('membershipEdges splits follow role from roster status', async () => {
    const { admin } = mockAdmin({
      memberships: {
        data: [
          { role: 'manager', kind: 'follow', status: 'active' },
          { role: 'member', kind: 'roster', status: 'pending' },
        ],
        error: null,
      },
    });
    const edges = await membershipEdges(admin, REF, 'them');
    expect(edges.followRole).toBe('manager');
    expect(edges.rosterStatus).toBe('pending');

    const followOnly = mockAdmin({
      memberships: { data: [{ role: 'member', kind: 'follow', status: 'active' }], error: null },
    });
    const edges2 = await membershipEdges(followOnly.admin, REF, 'them');
    expect(edges2.followRole).toBe('member');
    expect(edges2.rosterStatus).toBeNull();
  });

  it('redactPendingRoster hides pending offers from everyone but managers and the invitee', () => {
    const row = (profile_id: string, roster: 'pending' | 'active' | null) =>
      ({ profile_id, role: 'member', joined_at: '', profile: null, roster }) as never;
    const members = [row('a', 'pending'), row('b', 'active'), row('c', null)];
    expect(redactPendingRoster(members, true, 'x').map(m => m.roster)).toEqual([
      'pending',
      'active',
      null,
    ]);
    expect(redactPendingRoster(members, false, 'a').map(m => m.roster)).toEqual([
      'pending',
      'active',
      null,
    ]);
    expect(redactPendingRoster(members, false, 'c').map(m => m.roster)).toEqual([
      null,
      'active',
      null,
    ]);
  });

  it('getMemberRole reduces multi-row to max and surfaces the error', async () => {
    const ok = mockAdmin({
      memberships: { data: [{ role: 'member' }, { role: 'owner' }], error: null },
    });
    expect(await getMemberRole(ok.admin, REF, 'me')).toEqual({ role: 'owner', error: null });
    expect(ok.calls.map(c => c.table)).toEqual(['memberships']);
    const bad = mockAdmin({ memberships: { data: null, error: { code: '57014' } } });
    const res = await getMemberRole(bad.admin, REF, 'me');
    expect(res.role).toBeNull();
    expect(res.error).toEqual({ code: '57014' });
  });

  it('enumerations dedupe a dual-edge profile; counts are distinct people', async () => {
    const orgs = mockAdmin({
      memberships: {
        data: [
          { league_id: 'l1', club_id: null },
          { league_id: 'l1', club_id: null }, // roster twin
          { league_id: null, club_id: 'c1' },
        ],
        error: null,
      },
    });
    expect(await memberOrgIds(orgs.admin, 'me')).toEqual({ leagueIds: ['l1'], clubIds: ['c1'] });

    const counts = mockAdmin({
      memberships: {
        data: [
          { league_id: 'l1', profile_id: 'p1' },
          { league_id: 'l1', profile_id: 'p1' },
          { league_id: 'l1', profile_id: 'p2' },
        ],
        error: null,
      },
    });
    const map = await memberCountsByOrg(counts.admin, 'league', ['l1']);
    expect(map.get('l1')).toBe(2);

    const prof = mockAdmin({
      memberships: {
        data: [
          { league_id: 'l1', role: 'member' },
          { league_id: 'l1', role: 'manager' },
        ],
        error: null,
      },
    });
    const { rows } = await profileMembershipRows(prof.admin, 'league', 'me');
    expect(rows).toEqual([{ orgId: 'l1', role: 'manager' }]);
  });

  it('orgMemberPreview filters kind per query and max-reduces the viewer', async () => {
    const { admin, calls } = mockAdmin({
      memberships: {
        data: [
          { role: 'member', kind: 'follow', status: 'active' },
          { role: 'manager', kind: 'roster', status: 'pending' },
        ],
        error: null,
      },
    });
    const out = await orgMemberPreview(admin, REF, 'viewer', 12);
    expect(calls).toHaveLength(4);
    expect(calls[0].filters).toMatchObject({ kind: 'follow' }); // count
    expect(calls[1].filters).toMatchObject({ kind: 'follow' }); // list
    expect(calls[2].filters).toMatchObject({ kind: 'roster' }); // decorations
    expect(calls[3].filters).not.toHaveProperty('kind'); // viewer reads ALL rows
    expect(out.viewerRole).toBe('manager');
    expect(out.viewerRoster).toBe('pending');
  });

  it('memberOrgIds splits the pair, degrades missing-table to empty, throws otherwise', async () => {
    const ok = mockAdmin({
      memberships: {
        data: [
          { league_id: 'l1', club_id: null },
          { league_id: null, club_id: 'c1' },
        ],
        error: null,
      },
    });
    expect(await memberOrgIds(ok.admin, 'me')).toEqual({ leagueIds: ['l1'], clubIds: ['c1'] });
    const missing = mockAdmin({ memberships: { data: null, error: { code: '42P01' } } });
    expect(await memberOrgIds(missing.admin, 'me')).toEqual({ leagueIds: [], clubIds: [] });
    const broken = mockAdmin({ memberships: { data: null, error: { code: '57014' } } });
    await expect(memberOrgIds(broken.admin, 'me')).rejects.toEqual({ code: '57014' });
  });
});
