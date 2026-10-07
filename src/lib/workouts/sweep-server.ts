// ── The daily workout sweep: the 7-day rule (Drafts round PR 5, Oct 2026) ───
// A live session someone walked away from used to auto-complete after six
// quiet hours on the owner's next read — and land on their profile without a
// Finish. Now it stays in progress until the owner settles it, or until this
// sweep finishes it as it stands after ABANDON_AFTER_MS: completed, ended at
// its last activity, `share_decided_at` NULL — a DRAFT (Drafts offers Share /
// Keep private). Nothing is ever posted by this sweep.

import type { SupabaseClient } from '@supabase/supabase-js';
import { abandonFinalizeFields, isAbandonedSession } from './status';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const WORKOUT_SWEEP_LIMIT = 200;

export interface WorkoutSweepResult {
  examined: number;
  finished: number;
  failed: number;
}

export async function runWorkoutSweep(admin: Admin, now: number = Date.now()): Promise<WorkoutSweepResult> {
  const result: WorkoutSweepResult = { examined: 0, finished: 0, failed: 0 };
  const { data: actives, error } = await admin
    .from('workout_sessions')
    .select('id, status, started_at, last_activity_at')
    .eq('status', 'active')
    .order('last_activity_at', { ascending: true })
    .limit(WORKOUT_SWEEP_LIMIT);
  if (error) {
    console.error('[WORKOUT SWEEP] fetch failed:', error);
    return result;
  }
  for (const s of (actives ?? []) as Array<{ id: string; status: string; started_at: string; last_activity_at: string | null }>) {
    if (!isAbandonedSession({ status: s.status, lastActivityAt: s.last_activity_at, now })) continue;
    result.examined += 1;
    try {
      const { error: updateError } = await admin
        .from('workout_sessions')
        .update(abandonFinalizeFields({ startedAt: s.started_at, lastActivityAt: s.last_activity_at! }))
        .eq('id', s.id)
        .eq('status', 'active');
      if (updateError) throw updateError;
      result.finished += 1;
    } catch (e) {
      result.failed += 1;
      console.error(`[WORKOUT SWEEP] session ${s.id} failed:`, e);
    }
  }
  return result;
}
