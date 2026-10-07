import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { runWorkoutSweep } from '../workouts/sweep-server';

// Drafts round PR 5: the daily workout sweep finishes abandoned live sessions
// as they stand — a draft, never a post — and nothing else finishes them.

const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = Date.parse('2026-10-13T06:00:00Z');
const old = new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString();
const recent = new Date(NOW - 5 * 60 * 60 * 1000).toISOString();

function fakeAdmin(rows: unknown[]) {
  const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const reads = { select: () => reads, eq: () => reads, order: () => reads, limit: () => reads, then: (r: (v: unknown) => void) => r({ data: rows, error: null }) };
  const admin = {
    from: () => ({
      ...reads,
      update: (fields: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => ({ eq: () => { updates.push({ id, fields }); return Promise.resolve({ error: null }); } }),
      }),
    }),
  };
  return { admin: admin as never, updates };
}

describe('runWorkoutSweep', () => {
  it('finishes the week-old active session at its last activity; leaves the recent one', async () => {
    const { admin, updates } = fakeAdmin([
      { id: 'stale', status: 'active', started_at: new Date(NOW - 9 * 24 * 60 * 60 * 1000).toISOString(), last_activity_at: old },
      { id: 'fresh', status: 'active', started_at: recent, last_activity_at: recent },
    ]);
    const out = await runWorkoutSweep(admin, NOW);
    expect(out).toEqual({ examined: 1, finished: 1, failed: 0 });
    expect(updates).toEqual([{ id: 'stale', fields: { status: 'completed', ended_at: old, duration_seconds: 24 * 60 * 60 } }]);
  });
  it('is the ONLY place a workout is finished without its owner: the read routes no longer finalize', () => {
    const route = read('src/app/api/workouts/route.ts');
    expect(route).not.toMatch(/finalizeStaleActives|effectiveSessionStatus|staleFinalizeFields/);
    expect(read('src/app/api/cron/daily/route.ts')).toMatch(/summary\.workouts = await runWorkoutSweep\(admin\)/);
  });
  it('Share and Keep private both record the decision (253)', () => {
    const route = read('src/app/api/workouts/[id]/route.ts');
    expect(route.match(/updates\.share_decided_at = new Date\(\)\.toISOString\(\)/g)?.length).toBe(2);
    expect(read('src/components/workouts/WorkoutEditorScreen.tsx')).toMatch(/body: JSON\.stringify\(\{ keepPrivate: true \}\)/);
  });
});
