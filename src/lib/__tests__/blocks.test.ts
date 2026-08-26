import { describe, it, expect } from 'vitest';
import { filterBlockedBidirectional } from '../blocks';

const ACTOR = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';

/** Minimal admin stub for the .from('user_blocks').select().or() chain. */
function adminWith(rows: Array<{ blocker_id: string; blocked_id: string }> | null, error: unknown = null) {
  const calls: string[] = [];
  const admin = {
    from(table: string) {
      calls.push(table);
      return {
        select() {
          return {
            or: async () => ({ data: rows, error }),
          };
        },
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: admin as any, calls };
}

describe('filterBlockedBidirectional', () => {
  it('passes everyone through with no block rows, preserving order', async () => {
    const { admin } = adminWith([]);
    const res = await filterBlockedBidirectional(admin, ACTOR, [C, B]);
    expect(res).toEqual({ allowed: [C, B], skipped: 0 });
  });

  it('filters blocks in BOTH directions and counts them', async () => {
    // B blocked the actor; the actor blocked C; D is clean.
    const { admin } = adminWith([
      { blocker_id: B, blocked_id: ACTOR },
      { blocker_id: ACTOR, blocked_id: C },
    ]);
    const res = await filterBlockedBidirectional(admin, ACTOR, [B, C, D]);
    expect(res).toEqual({ allowed: [D], skipped: 2 });
  });

  it('dedupes ids and drops the actor without counting them as skipped', async () => {
    const { admin } = adminWith([]);
    const res = await filterBlockedBidirectional(admin, ACTOR, [B, B, ACTOR]);
    expect(res).toEqual({ allowed: [B], skipped: 0 });
  });

  it('short-circuits on an empty candidate set (no query at all)', async () => {
    const { admin, calls } = adminWith([]);
    const res = await filterBlockedBidirectional(admin, ACTOR, [ACTOR]);
    expect(res).toEqual({ allowed: [], skipped: 0 });
    expect(calls).toHaveLength(0);
  });

  it('fails OPEN on a query error (best-effort gate, never takes the feature down)', async () => {
    const { admin } = adminWith(null, { message: 'boom' });
    const res = await filterBlockedBidirectional(admin, ACTOR, [B, C]);
    expect(res).toEqual({ allowed: [B, C], skipped: 0 });
  });
});
