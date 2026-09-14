/**
 * Joining — the I/O half (Events program, PR 4). Reads the roster, asks
 * `planJoin` (pure) what to write, writes it, promotes the waitlist,
 * freezes the index on an accept, sends the bells. Every write is on the
 * admin client; the route's gate (readSportEventAccess + the actor rules
 * here) IS the authorization.
 *
 * Ordering is honest but not serialised: two accepts racing for the last
 * seat may both land accepted (no advisory lock yet). The organizer sees
 * one seat over and removes; the phase-2 note names a `FOR UPDATE` RPC.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SportEventAccess } from './access';
import { PARTICIPANT_COLUMNS } from './access-server';
import { snapshotAtAccept } from './handicap-server';
import { planCapacityChange, planJoin, type JoinAction, type ParticipantSnapshot } from './join';
import { syncRoundRoster } from './lifecycle-server';
import { notifyDecision, notifyRequest } from './notify';
import type { SportEventParticipantRow, SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const SELF_ACTIONS: ReadonlySet<JoinAction> = new Set(['request', 'accept', 'decline', 'withdraw', 'follow', 'unfollow']);
export const ORGANIZER_ACTIONS: ReadonlySet<JoinAction> = new Set(['approve', 'reject', 'remove']);

export function toSnapshot(r: SportEventParticipantRow): ParticipantSnapshot {
  return { id: r.id, profileId: r.profile_id, role: r.role, status: r.status, playing: r.playing, waitlistPosition: r.waitlist_position, createdAt: r.created_at };
}

export async function readRoster(admin: Admin, eventId: string): Promise<SportEventParticipantRow[]> {
  const { data, error } = await admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('sport_event_id', eventId).order('created_at', { ascending: true });
  if (error) {
    console.error('[sport-events] roster read failed:', error);
    return [];
  }
  return (data ?? []) as SportEventParticipantRow[];
}

export type JoinOutcome =
  | { ok: true; participant: SportEventParticipantRow | null; promoted: string[] }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

export interface JoinRequest {
  event: SportEventRow;
  access: SportEventAccess;
  action: JoinAction;
  /** The acting profile (self, or the supervised athlete a guardian acts for). */
  actorProfileId: string;
  /** For organizer actions: the target participant row id. */
  targetParticipantId?: string | null;
}

/** Promote the given waitlisted rows: accepted, seat, index snapshot, bell. */
export async function promoteRows(admin: Admin, event: Pick<SportEventRow, 'id' | 'name' | 'status'>, rows: SportEventParticipantRow[], ids: string[], actorProfileId: string): Promise<string[]> {
  const promoted: string[] = [];
  const now = new Date().toISOString();
  for (const id of ids) {
    const row = rows.find(r => r.id === id);
    if (!row) continue;
    const { error } = await admin.from('sport_event_participants').update({ status: 'accepted', waitlist_position: null, accepted_at: now }).eq('id', id).eq('status', 'waitlisted');
    if (error) {
      console.error('[sport-events] promotion write failed:', error);
      continue;
    }
    promoted.push(id);
    await snapshotAtAccept(admin, row);
    if (event.status === 'live') await syncRoundRoster(admin, event.id, row.profile_id, 'add');
    await notifyDecision({ admin, eventId: event.id, eventName: event.name, actorProfileId }, row.profile_id, 'promoted');
  }
  return promoted;
}

export async function applyJoin(admin: Admin, req: JoinRequest): Promise<JoinOutcome> {
  const { event, access, action, actorProfileId } = req;
  const rows = await readRoster(admin, event.id);
  const snapshots = rows.map(toSnapshot);

  let row: SportEventParticipantRow | null = null;
  if (SELF_ACTIONS.has(action)) {
    row = rows.find(r => r.profile_id === actorProfileId) ?? null;
  } else if (ORGANIZER_ACTIONS.has(action)) {
    if (!access.canManage) return { ok: false, status: 403, error: 'Only an organizer can do that.' };
    if (!req.targetParticipantId) return { ok: false, status: 400, error: 'participant id required' };
    row = rows.find(r => r.id === req.targetParticipantId) ?? null;
    if (!row) return { ok: false, status: 404, error: 'Participant not found' };
  } else {
    return { ok: false, status: 400, error: 'Unknown action.' };
  }

  const plan = planJoin(action, {
    event: { status: event.status, joinMode: event.join_mode, capacity: event.capacity },
    actorRole: access.role,
    row: row ? toSnapshot(row) : null,
    rows: snapshots,
  });
  if (!plan.ok) return { ok: false, status: plan.status, error: plan.error };

  const now = new Date().toISOString();
  const bell = { admin, eventId: event.id, eventName: event.name, actorProfileId };

  if (plan.delete && row) {
    const { error } = await admin.from('sport_event_participants').delete().eq('id', row.id);
    if (error) return { ok: false, status: 409, error: 'Could not update the roster.' };
    return { ok: true, participant: null, promoted: [] };
  }

  const patch: Record<string, unknown> = {};
  if (plan.next.role !== undefined) patch.role = plan.next.role;
  if (plan.next.status !== undefined) patch.status = plan.next.status;
  if (plan.next.playing !== undefined) patch.playing = plan.next.playing;
  if (plan.next.waitlistPosition !== undefined) patch.waitlist_position = plan.next.waitlistPosition;
  if (plan.next.accepted) patch.accepted_at = now;
  if (plan.next.responded) patch.responded_at = now;

  let written: SportEventParticipantRow | null = null;
  if (plan.create) {
    const { data, error } = await admin
      .from('sport_event_participants')
      .insert({ sport_event_id: event.id, profile_id: actorProfileId, invited_by: null, ...patch })
      .select(PARTICIPANT_COLUMNS)
      .single();
    if (error) {
      console.error('[sport-events] participant insert failed:', error);
      return { ok: false, status: 409, error: 'Could not update the roster.' };
    }
    written = data as SportEventParticipantRow;
  } else if (row) {
    const { data, error } = await admin.from('sport_event_participants').update(patch).eq('id', row.id).select(PARTICIPANT_COLUMNS).single();
    if (error) {
      console.error('[sport-events] participant update failed:', error);
      return { ok: false, status: 409, error: 'Could not update the roster.' };
    }
    written = data as SportEventParticipantRow;
  }

  if (written && plan.next.accepted) {
    await snapshotAtAccept(admin, written);
    if (event.status === 'live') await syncRoundRoster(admin, event.id, written.profile_id, 'add');
  }
  if (row && event.status === 'live' && (action === 'withdraw' || action === 'remove') && row.status === 'accepted' && row.playing) {
    await syncRoundRoster(admin, event.id, row.profile_id, 'drop');
  }

  const promoted = plan.promote.length > 0 ? await promoteRows(admin, event, rows, plan.promote, actorProfileId) : [];

  // Bells.
  if (action === 'request') {
    const organizers = rows.filter(r => (r.role === 'organizer' || r.role === 'co_organizer') && r.status === 'accepted').map(r => r.profile_id);
    await notifyRequest(bell, [event.host_profile_id, ...organizers]);
  } else if (action === 'approve' && row) {
    await notifyDecision(bell, row.profile_id, written?.status === 'accepted' ? 'approved' : 'promoted');
  } else if (action === 'reject' && row) {
    await notifyDecision(bell, row.profile_id, 'rejected');
  }

  return { ok: true, participant: written, promoted };
}

/** A capacity change: promote as many as the new room allows. */
export async function applyCapacityChange(admin: Admin, event: SportEventRow, newCapacity: number | null, actorProfileId: string): Promise<string[]> {
  const rows = await readRoster(admin, event.id);
  const ids = planCapacityChange(rows.map(toSnapshot), newCapacity);
  return ids.length > 0 ? promoteRows(admin, event, rows, ids, actorProfileId) : [];
}
