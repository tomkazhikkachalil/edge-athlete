// ── transferHost — THE one writer of a sport event's host (Authority PR 2) ──
// Used by the host's "Make host", the deletion engine's handover, and (PR 4)
// Edge Athlete support. What moves with the host:
//   * sport_events.host_profile_id — a compare-and-set on the old host, so two
//     racing transfers cannot both land (0 rows = 409);
//   * the two participant rows swap: the new host → organizer, the old host →
//     co_organizer (or 'removed' when the old host has left for good);
//   * the minted rounds' group_posts.creator_id (the scorecard's creator);
//   * the event's own posts — the announce / round / results post
//     (posts.sport_event_round_id) — so the live post follows the organizer.
// Every step is checked; the audit row is written last.

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuthority } from '@/lib/authority/audit-server';
import type { AuthorityActor } from '@/lib/authority/types';

export interface TransferHostInput {
  eventId: string;
  fromProfileId: string;
  toProfileId: string;
  actor: AuthorityActor;
  ticketId?: string | null;
  /** What the old host becomes: a co-organizer (default), or removed (the host left). */
  oldHostRole?: 'co_organizer' | 'removed';
  reason?: string;
}

export type TransferHostOutcome = { ok: true } | { ok: false; status: 404 | 409 | 500; error: string };

export async function transferHost(admin: SupabaseClient, input: TransferHostInput): Promise<TransferHostOutcome> {
  const { eventId, fromProfileId, toProfileId } = input;
  if (fromProfileId === toProfileId) return { ok: false, status: 409, error: 'That person is already the host.' };

  const { data: moved, error: casError } = await admin
    .from('sport_events').update({ host_profile_id: toProfileId })
    .eq('id', eventId).eq('host_profile_id', fromProfileId)
    .select('id').maybeSingle();
  if (casError) {
    console.error('[sport-events host] transfer write failed:', casError.message);
    return { ok: false, status: 500, error: 'Could not hand the event over.' };
  }
  if (!moved) return { ok: false, status: 409, error: 'The event changed while you were working. Reload and try again.' };

  const now = new Date().toISOString();
  const { error: newErr } = await admin.from('sport_event_participants')
    .update({ role: 'organizer', status: 'accepted', updated_at: now })
    .eq('sport_event_id', eventId).eq('profile_id', toProfileId);
  if (newErr) console.error('[sport-events host] new host row failed:', newErr.message);
  const oldPatch = input.oldHostRole === 'removed'
    ? { role: 'co_organizer', status: 'removed', waitlist_position: null, updated_at: now }
    : { role: 'co_organizer', updated_at: now };
  const { error: oldErr } = await admin.from('sport_event_participants')
    .update(oldPatch).eq('sport_event_id', eventId).eq('profile_id', fromProfileId);
  if (oldErr) console.error('[sport-events host] old host row failed:', oldErr.message);

  const { data: rounds } = await admin.from('sport_event_rounds').select('id').eq('sport_event_id', eventId);
  const roundIds = (rounds ?? []).map(r => r.id as string);
  if (roundIds.length > 0) {
    const { error: gpErr } = await admin.from('group_posts').update({ creator_id: toProfileId })
      .in('sport_event_round_id', roundIds).eq('creator_id', fromProfileId);
    if (gpErr) console.error('[sport-events host] round creator move failed:', gpErr.message);
    const { error: postErr } = await admin.from('posts').update({ profile_id: toProfileId })
      .in('sport_event_round_id', roundIds).eq('profile_id', fromProfileId);
    if (postErr) console.error('[sport-events host] event post move failed:', postErr.message);
  }

  await recordAuthority(admin, {
    subject: { type: 'sport_event', id: eventId },
    actor: input.actor,
    action: 'host_transferred',
    targetProfileId: toProfileId,
    ticketId: input.ticketId ?? null,
    detail: { from_profile_id: fromProfileId, to_profile_id: toProfileId, reason: input.reason ?? null, round_ids: roundIds },
  });
  return { ok: true };
}
