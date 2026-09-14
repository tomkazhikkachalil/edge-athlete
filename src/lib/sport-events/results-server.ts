/**
 * Results — the I/O half (Events program, PR 7): the opt-out applied late
 * (after completion). The results bell is notify.ts notifyResults.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mirrorCompletedRound } from '@/lib/golf/round-mirror';
import { readRounds } from './lifecycle-server';
import { removeMirrorFor } from './opt-out';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/**
 * A participant flipped hide_from_profile after the event completed:
 * true → their mirror rows go; false → the round is re-mirrored (the
 * mirror skips everyone still hidden and rebuilds the rest idempotently).
 */
export async function applyProfileOptOut(admin: Admin, eventId: string, profileId: string, hidden: boolean): Promise<void> {
  const rounds = await readRounds(admin, eventId);
  for (const round of rounds) {
    if (!round.group_post_id) continue;
    if (hidden) await removeMirrorFor(admin, round.group_post_id, profileId);
    else await mirrorCompletedRound(admin, round.group_post_id);
  }
}
