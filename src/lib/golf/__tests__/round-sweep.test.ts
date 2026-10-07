import { describe, it, expect, vi } from 'vitest';
import { runRoundSweep } from '../round-sweep';

// Drafts round PR 3 (Oct 2026): the daily sweep is the ONE place an untouched
// round is settled — an active one FINISHED as played (the record written,
// the post a draft), a scoreless pending one DISCARDED. It never touches
// posts.status, never an event's round, never a recent round.

vi.mock('../round-finish', () => ({ finishRound: vi.fn(async () => ({ status: 'finished' })) }));
vi.mock('../round-delete-server', () => ({ deleteRoundCascade: vi.fn(async () => ({ status: 'deleted' })) }));

import { finishRound } from '../round-finish';
import { deleteRoundCascade } from '../round-delete-server';

const NOW = Date.parse('2026-10-13T06:00:00Z');
const old = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
const recent = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();

const row = (id: string, status: string, created_at: string, lastScore: string | null) => ({
  id, status, created_at, creator_id: 'creator', sport_event_round_id: null,
  participants: [{ scores: lastScore ? { updated_at: lastScore } : null }],
});

function fakeAdmin(rows: unknown[]) {
  const writes: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit']) builder[m] = () => builder;
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  const admin = {
    from: (table: string) => {
      writes.push(table);
      return builder;
    },
  };
  return { admin: admin as never, writes };
}

describe('runRoundSweep', () => {
  it('finishes the week-old active round, discards the week-old scoreless one, leaves the recent ones', async () => {
    vi.mocked(finishRound).mockClear();
    vi.mocked(deleteRoundCascade).mockClear();
    const { admin, writes } = fakeAdmin([
      row('quiet-active', 'active', old, old),
      row('scoreless', 'pending', old, null),
      row('fresh-active', 'active', old, recent),
      row('fresh-pending', 'pending', recent, null),
    ]);
    const out = await runRoundSweep(admin, NOW);
    expect(out).toEqual({ examined: 2, finished: 1, discarded: 1, failed: 0 });
    expect(vi.mocked(finishRound).mock.calls.map(c => c[1])).toEqual(['quiet-active']);
    expect(vi.mocked(deleteRoundCascade).mock.calls.map(c => [c[1], c[2]])).toEqual([['scoreless', 'creator']]);
    // The sweep reads group_posts and writes nothing of its own — never posts.status.
    expect(writes).toEqual(['group_posts']);
  });

  it('one failing round does not stop the rest', async () => {
    vi.mocked(finishRound).mockClear().mockResolvedValueOnce({ status: 'error', message: 'nope' }).mockResolvedValueOnce({ status: 'finished' });
    const { admin } = fakeAdmin([row('a', 'active', old, old), row('b', 'active', old, old)]);
    const out = await runRoundSweep(admin, NOW);
    expect(out).toEqual({ examined: 2, finished: 1, discarded: 0, failed: 1 });
  });

  it('an event\'s round is never on the list (the query excludes it) and never acted on', async () => {
    vi.mocked(finishRound).mockClear();
    const { admin } = fakeAdmin([{ ...row('ev', 'active', old, old), sport_event_round_id: 'r1' }]);
    const out = await runRoundSweep(admin, NOW);
    expect(out.examined).toBe(0);
    expect(finishRound).not.toHaveBeenCalled();
  });
});
