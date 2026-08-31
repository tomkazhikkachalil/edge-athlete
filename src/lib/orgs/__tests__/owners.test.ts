import { describe, expect, it, vi } from 'vitest';
import { promoteGuard, recomputePrimaryOwner, stepDownGuard } from '../owners';

type Admin = Parameters<typeof recomputePrimaryOwner>[0];

interface RecordedCall {
  table: string;
  op: string;
  payload?: unknown;
  filters: Record<string, unknown>;
}

function mockAdmin(results: Partial<Record<string, { data?: unknown; error: { code: string } | null }>>) {
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
        order: () => chain,
        select: () => chain,
        maybeSingle: async () => result,
        then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return {
        select: () => chain,
        update(payload: unknown) {
          call.op = 'update';
          call.payload = payload;
          return chain;
        },
      };
    },
  };
  return { admin: admin as unknown as Admin, calls };
}

describe('promoteGuard', () => {
  it('runs the full matrix', () => {
    expect(promoteGuard({ callerRole: 'manager', targetFollowRole: 'member', targetSupervised: false }))
      .toEqual({ ok: false, status: 403, error: 'Only owners can add owners' });
    expect(promoteGuard({ callerRole: 'owner', targetFollowRole: 'member', targetSupervised: true }).ok)
      .toBe(false);
    expect(promoteGuard({ callerRole: 'owner', targetFollowRole: null, targetSupervised: false }))
      .toEqual({ ok: false, status: 400, error: 'Only current members can be made owners' });
    expect(promoteGuard({ callerRole: 'owner', targetFollowRole: 'owner', targetSupervised: false }))
      .toEqual({ ok: false, status: 400, error: 'Already an owner' });
    expect(promoteGuard({ callerRole: 'owner', targetFollowRole: 'manager', targetSupervised: false }))
      .toEqual({ ok: true });
  });
});

describe('stepDownGuard', () => {
  it('non-owner 403; last owner 400; otherwise ok', () => {
    expect(stepDownGuard({ callerIsOwner: false, ownerCount: 2 }))
      .toEqual({ ok: false, status: 403, error: 'Only owners can step down' });
    expect(stepDownGuard({ callerIsOwner: true, ownerCount: 1 }))
      .toEqual({ ok: false, status: 400, error: "You're the last owner — promote a co-owner first" });
    expect(stepDownGuard({ callerIsOwner: true, ownerCount: 2 })).toEqual({ ok: true });
  });
});

describe('recomputePrimaryOwner', () => {
  const OWNERS = [
    { id: 'row-a', profile_id: 'early', joined_at: '2026-01-01' },
    { id: 'row-b', profile_id: 'late', joined_at: '2026-02-01' },
  ];

  it('writes the earliest owner to the cache column', async () => {
    const { admin, calls } = mockAdmin({ memberships: { data: OWNERS, error: null } });
    const { error } = await recomputePrimaryOwner(admin, { side: 'league', orgId: 'org-1' });
    expect(error).toBeNull();
    const update = calls.find(c => c.table === 'leagues');
    expect(update?.op).toBe('update');
    expect(update?.payload).toEqual({ owner_profile_id: 'early' });
    expect(update?.filters).toEqual({ id: 'org-1' });
  });

  it('honors excludeProfileId (the step-down / account-deletion path)', async () => {
    const { admin, calls } = mockAdmin({ memberships: { data: OWNERS, error: null } });
    await recomputePrimaryOwner(admin, { side: 'club', orgId: 'org-1' }, { excludeProfileId: 'early' });
    const update = calls.find(c => c.table === 'clubs');
    expect(update?.payload).toEqual({ owner_profile_id: 'late' });
  });

  it('zero remaining owners → no-op with a warning, never NULLs', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { admin, calls } = mockAdmin({ memberships: { data: [], error: null } });
    const { error } = await recomputePrimaryOwner(admin, { side: 'league', orgId: 'org-1' });
    expect(error).toBeNull();
    expect(calls.some(c => c.op === 'update')).toBe(false);
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
