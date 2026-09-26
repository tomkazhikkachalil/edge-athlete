// ── applyRoleChange — the event role actions (Authority PR 2) ───────────────
// make_co_organizer / make_participant / step_down write the target row;
// make_host goes through the ONE host writer (host-transfer-server.ts).
// Every change is recorded in the authority log.

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuthority } from '@/lib/authority/audit-server';
import { readAuthorityHolders } from '@/lib/authority/holders-server';
import { PARTICIPANT_COLUMNS } from './access-server';
import { transferHost } from './host-transfer-server';
import { planRoleChange, type RoleAction } from './roles';
import type { SportEventParticipantRow, SportEventRow } from './types';

export type RoleChangeOutcome =
  | { ok: true; participant: SportEventParticipantRow | null; hostTransferred: boolean }
  | { ok: false; status: 403 | 404 | 409 | 500; error: string };

export async function applyRoleChange(
  admin: SupabaseClient,
  input: { event: SportEventRow; action: RoleAction; actorProfileId: string; target: SportEventParticipantRow }
): Promise<RoleChangeOutcome> {
  const { event, action, actorProfileId, target } = input;
  const holders = await readAuthorityHolders(admin, [target.profile_id]);
  const plan = planRoleChange(action, {
    eventStatus: event.status,
    actorIsHost: event.host_profile_id === actorProfileId,
    actorIsTarget: target.profile_id === actorProfileId,
    target: { role: target.role, status: target.status, playing: target.playing },
    targetHoldsAuthority: holders.get(target.profile_id) === true,
  });
  if (!plan.ok) return plan;

  if (plan.kind === 'host') {
    const moved = await transferHost(admin, {
      eventId: event.id,
      fromProfileId: event.host_profile_id,
      toProfileId: target.profile_id,
      actor: { kind: 'member', profileId: actorProfileId },
      reason: 'host_handover',
    });
    if (!moved.ok) return moved;
    const { data: fresh } = await admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('id', target.id).maybeSingle();
    return { ok: true, participant: (fresh as SportEventParticipantRow | null) ?? null, hostTransferred: true };
  }

  const { data: updated, error } = await admin
    .from('sport_event_participants')
    .update({ ...plan.next, updated_at: new Date().toISOString() })
    .eq('id', target.id).eq('role', target.role) // a compare-and-set on the role: two racing changes cannot both land
    .select(PARTICIPANT_COLUMNS).maybeSingle();
  if (error) {
    console.error('[sport-events roles] write failed:', error.message);
    return { ok: false, status: 500, error: 'Could not change the role.' };
  }
  if (!updated) return { ok: false, status: 409, error: 'The roster changed while you were working. Reload and try again.' };

  await recordAuthority(admin, {
    subject: { type: 'sport_event', id: event.id },
    actor: { kind: 'member', profileId: actorProfileId },
    action: plan.next.role === 'co_organizer' ? 'co_organizer_added' : 'co_organizer_removed',
    targetProfileId: target.profile_id,
    detail: { participant_id: target.id, from_role: target.role, to_role: plan.next.role, via: action },
  });
  return { ok: true, participant: updated as SportEventParticipantRow, hostTransferred: false };
}

/** A co-organizer invite — the host named a backup (recorded; the accept
 *  records `co_organizer_added` in join-server). */
export async function recordCoOrganizerInvited(admin: SupabaseClient, eventId: string, actorProfileId: string, inviteeProfileId: string, playing: boolean): Promise<void> {
  await recordAuthority(admin, {
    subject: { type: 'sport_event', id: eventId },
    actor: { kind: 'member', profileId: actorProfileId },
    action: 'co_organizer_invited',
    targetProfileId: inviteeProfileId,
    detail: { role: 'co_organizer', status: playing ? 'playing' : 'not_playing' },
  });
}
