import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getMemberRole,
  insertOwnerRow,
  joinOrg,
  leaveOrg,
  memberOrgIds,
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

describe('dual-write order and authority', () => {
  it('joinOrg writes the legacy table FIRST, then mirrors to memberships', async () => {
    const { admin, calls } = mockAdmin({});
    const { error } = await joinOrg(admin, REF, 'me');
    expect(error).toBeNull();
    expect(calls.map(c => c.table)).toEqual(['league_members', 'memberships']);
    expect(calls[0].payload).toEqual({ league_id: 'org-1', profile_id: 'me' });
    expect(calls[1].payload).toEqual({ league_id: 'org-1', profile_id: 'me' });
  });

  it('a legacy-write failure is returned and the mirror is never attempted', async () => {
    const failure = { code: '23503' };
    const { admin, calls } = mockAdmin({ league_members: { error: failure } });
    const { error } = await joinOrg(admin, REF, 'me');
    expect(error).toBe(failure);
    expect(calls.map(c => c.table)).toEqual(['league_members']);
  });

  it('insertOwnerRow carries role owner to BOTH tables', async () => {
    const { admin, calls } = mockAdmin({});
    await insertOwnerRow(admin, CLUB_REF, 'owner-1');
    expect(calls.map(c => c.table)).toEqual(['club_members', 'memberships']);
    for (const call of calls) {
      expect(call.payload).toEqual({ club_id: 'club-1', profile_id: 'owner-1', role: 'owner' });
    }
  });
});

describe('mirror failure policy', () => {
  it('a mirror 23505 (backfill overlap) is swallowed with no error log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin } = mockAdmin({ memberships: { error: { code: '23505' } } });
    const { error } = await joinOrg(admin, REF, 'me');
    expect(error).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('any other mirror failure logs the greppable tag but never fails the request', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { admin } = mockAdmin({ memberships: { error: { code: '57014' } } });
    const { error } = await setMemberRole(admin, REF, 'them', 'manager');
    expect(error).toBeNull();
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain('[MEMBERSHIPS DUAL-WRITE]');
  });
});

describe('mirror filters keep legacy paths off future roster rows', () => {
  it('leaveOrg mirror delete filters org + profile + kind=follow + scope_type=org', async () => {
    const { admin, calls } = mockAdmin({});
    await leaveOrg(admin, REF, 'me');
    const mirror = calls[1];
    expect(mirror.table).toBe('memberships');
    expect(mirror.op).toBe('delete');
    expect(mirror.filters).toEqual({
      league_id: 'org-1',
      profile_id: 'me',
      kind: 'follow',
      scope_type: 'org',
    });
  });

  it('removeMember and setMemberRole mirrors carry the same filters (club side)', async () => {
    const { admin, calls } = mockAdmin({});
    await removeMember(admin, CLUB_REF, 'them');
    await setMemberRole(admin, CLUB_REF, 'them', 'member');
    const [, removeMirror, , roleMirror] = calls;
    for (const mirror of [removeMirror, roleMirror]) {
      expect(mirror.table).toBe('memberships');
      expect(mirror.filters).toEqual({
        club_id: 'club-1',
        profile_id: 'them',
        kind: 'follow',
        scope_type: 'org',
      });
    }
    expect(roleMirror.payload).toEqual({ role: 'member' });
    expect(calls[2].payload).toEqual({ role: 'member' });
  });

  it('reads hit only memberships: getMemberRole surfaces the row role and the error', async () => {
    const ok = mockAdmin({ memberships: { data: { role: 'manager' }, error: null } });
    expect(await getMemberRole(ok.admin, REF, 'me')).toEqual({ role: 'manager', error: null });
    expect(ok.calls.map(c => c.table)).toEqual(['memberships']);
    const bad = mockAdmin({ memberships: { data: null, error: { code: '57014' } } });
    const res = await getMemberRole(bad.admin, REF, 'me');
    expect(res.role).toBeNull();
    expect(res.error).toEqual({ code: '57014' });
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

  it('legacy update/delete filters stay byte-identical to the pre-layer queries', async () => {
    const { admin, calls } = mockAdmin({});
    await setMemberRole(admin, REF, 'them', 'manager');
    const legacy = calls[0];
    expect(legacy.table).toBe('league_members');
    expect(legacy.op).toBe('update');
    expect(legacy.payload).toEqual({ role: 'manager' });
    expect(legacy.filters).toEqual({ league_id: 'org-1', profile_id: 'them' });
  });
});
