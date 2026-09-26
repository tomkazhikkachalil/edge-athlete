/**
 * Results — the I/O half (Events program, PR 7): the opt-out applied late
 * (after completion). The results bell is notify.ts notifyResults.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mirrorCompletedRound } from '@/lib/golf/round-mirror';
import { EVENT_COLUMNS } from './access-server';
import { readRounds } from './lifecycle-server';
import { applyStatOptOut } from './stat-results-server';
import { isStatShape, shapeOf, type SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

/**
 * A participant flipped hide_from_profile after the event completed.
 * Results-kept round (241): the result is HIDDEN from their profile, never
 * removed — true → their mirrors are stamped hidden (the re-mirror stamps
 * them); false → the stamps are cleared. The handicap, the leaderboards, the
 * org's contest and the dataset keep it either way.
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
    if (!hidden) {
      const { error } = await admin.from('golf_rounds').update({ profile_hidden_at: null }).eq('group_post_id', round.group_post_id).eq('profile_id', profileId);
      if (error) console.error('[sport-events opt-out] unhide failed:', error.message);
    }
    // Idempotent: (re)writes every mirror and stamps the still-hidden ones.
    await mirrorCompletedRound(admin, round.group_post_id);
  }
}
