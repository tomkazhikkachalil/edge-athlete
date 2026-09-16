/**
 * Results — the I/O half (Events program, PR 7): the opt-out applied late
 * (after completion). The results bell is notify.ts notifyResults.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mirrorCompletedRound } from '@/lib/golf/round-mirror';
import { EVENT_COLUMNS } from './access-server';
import { readRounds } from './lifecycle-server';
import { removeMirrorFor } from './opt-out';
import { applyStatOptOut } from './stat-results-server';
import { isStatShape, shapeOf, type SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/**
 * A participant flipped hide_from_profile after the event completed:
 * true → their mirror rows go; false → the round is re-mirrored (the
 * mirror skips everyone still hidden and rebuilds the rest idempotently).
 */
export async function applyProfileOptOut(admin: Admin, eventId: string, profileId: string, hidden: boolean): Promise<void> {
  const { data: ev } = await admin.from('sport_events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle();
  const event = (ev as SportEventRow | null) ?? null;
  const shape = event ? shapeOf(event) : 'round';
  const rounds = await readRounds(admin, eventId, shape);
  // Phase 4: a stat event's mirror is its lines' posts (no group post).
  if (event && isStatShape(shape)) { await applyStatOptOut(admin, event, rounds, profileId, hidden); return; }
  for (const round of rounds) {
    if (!round.group_post_id) continue;
    if (hidden) await removeMirrorFor(admin, round.group_post_id, profileId);
    else await mirrorCompletedRound(admin, round.group_post_id);
  }
}
