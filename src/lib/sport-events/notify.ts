/**
 * The sport_event_* bells (Events program, PR 4) — direct inserts on the
 * admin client (create_notification's preference gate has no branch for
 * these types and would drop them silently — the shared-round precedent),
 * every sender BEST-EFFORT. A supervised invitee gets their own bell AND a
 * guardian copy (notifyGuardians, the roster-invite shape). The copy is
 * pure (`bellCopy`) so a node test pins every line.
 *
 * Phase-1 senders: invite, request, request_decision (approve / reject /
 * a waitlist promotion), results (completion — results-server.ts).
 * `sport_event_live` is registered and unsent (Live Now is the surface).
 */
import { isMatchFormat } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyGuardians } from '@/lib/guardian-notify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export type SportEventBell = 'sport_event_invite' | 'sport_event_request' | 'sport_event_request_decision' | 'sport_event_results' | 'sport_event_reminder';

export interface BellCopy {
  type: SportEventBell;
  title: string;
  message: string | null;
  action_url: string;
}

export function eventPath(eventId: string, tab?: 'players' | 'leaderboard' | 'overview' | 'matches'): string {
  return tab ? `/events/${eventId}?tab=${tab}` : `/events/${eventId}`;
}

export function bellCopy(
  kind: 'invite' | 'request' | 'approved' | 'rejected' | 'promoted' | 'results',
  ctx: { eventId: string; eventName: string; actorName: string; matchPlay?: boolean },
): BellCopy {
  switch (kind) {
    case 'invite':
      return { type: 'sport_event_invite', title: `${ctx.actorName} invited you to ${ctx.eventName}`, message: 'Accept to play, or decline.', action_url: eventPath(ctx.eventId, 'players') };
    case 'request':
      return { type: 'sport_event_request', title: `${ctx.actorName} asked to join ${ctx.eventName}`, message: 'Approve or decline the request.', action_url: eventPath(ctx.eventId, 'players') };
    case 'approved':
      return { type: 'sport_event_request_decision', title: `You're in: ${ctx.eventName}`, message: `${ctx.actorName} accepted your request.`, action_url: eventPath(ctx.eventId) };
    case 'rejected':
      return { type: 'sport_event_request_decision', title: `Not this time: ${ctx.eventName}`, message: `${ctx.actorName} declined your request.`, action_url: eventPath(ctx.eventId) };
    case 'promoted':
      return { type: 'sport_event_request_decision', title: `A spot opened up: ${ctx.eventName}`, message: "You're off the waitlist and in the field.", action_url: eventPath(ctx.eventId) };
    case 'results':
      return ctx.matchPlay
        ? { type: 'sport_event_results', title: `Results are in for ${ctx.eventName}`, message: 'See how every match ended.', action_url: eventPath(ctx.eventId, 'matches') }
        : { type: 'sport_event_results', title: `Results are in for ${ctx.eventName}`, message: 'See the final leaderboard.', action_url: eventPath(ctx.eventId, 'leaderboard') };
  }
}

export async function actorDisplayName(admin: Admin, profileId: string): Promise<string> {
  const { data } = await admin.from('profiles').select('first_name, last_name, full_name, display_name').eq('id', profileId).maybeSingle();
  if (!data) return 'Someone';
  return [data.first_name, data.last_name].filter(Boolean).join(' ') || data.display_name || data.full_name || 'Someone';
}

/** ONE insert per call; `metadata` is the jsonb column (never `data`). Returns the insert error so a caller can read a CHECK miss (23514). */
export async function insertBells(admin: Admin, recipients: string[], actorId: string | null, copy: BellCopy, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<{ error: { code?: string; message?: string } | null }> {
  const unique = [...new Set(recipients)].filter(id => id && id !== actorId);
  if (unique.length === 0) return { error: null };
  try {
    const { error } = await admin.from('notifications').insert(
      unique.map(user_id => ({
        user_id,
        type: copy.type,
        actor_id: actorId,
        title: copy.title,
        message: copy.message,
        action_url: copy.action_url,
        is_read: false,
        metadata,
        ...extra,
      })),
    );
    if (error) {
      console.error('[sport-events notify] insert failed:', error);
      return { error: { code: (error as { code?: string }).code, message: error.message } };
    }
    return { error: null };
  } catch (e) {
    console.error('[sport-events notify] insert failed:', e);
    return { error: { message: String(e) } };
  }
}

export interface BellContext {
  admin: Admin;
  eventId: string;
  eventName: string;
  actorProfileId: string;
}

/** Invite bells to the invitees; a supervised invitee's guardians get a copy. */
export async function notifyInvites(ctx: BellContext, inviteeProfileIds: string[]): Promise<void> {
  if (inviteeProfileIds.length === 0) return;
  const actorName = await actorDisplayName(ctx.admin, ctx.actorProfileId);
  const copy = bellCopy('invite', { eventId: ctx.eventId, eventName: ctx.eventName, actorName });
  const meta = { sport_event_id: ctx.eventId, sport_event_name: ctx.eventName };
  // action_status pending: the bell carries Accept / Decline until decided (the action route).
  await insertBells(ctx.admin, inviteeProfileIds, ctx.actorProfileId, copy, meta, { action_status: 'pending' });
  try {
    const { data: supervised } = await ctx.admin.from('profiles').select('id').in('id', inviteeProfileIds).eq('supervision_state', 'supervised');
    for (const child of supervised ?? []) {
      await notifyGuardians(ctx.admin, child.id as string, {
        type: 'sport_event_invite',
        title: copy.title.replace('invited you', 'invited your athlete'),
        message: copy.message,
        actionUrl: copy.action_url,
        actorId: ctx.actorProfileId,
        metadata: meta,
      }, ctx.actorProfileId);
    }
  } catch (e) {
    console.error('[sport-events notify] guardian copy failed:', e);
  }
}

/** A join request → the host and the co-organizers. */
export async function notifyRequest(ctx: BellContext, organizerProfileIds: string[]): Promise<void> {
  const actorName = await actorDisplayName(ctx.admin, ctx.actorProfileId);
  const copy = bellCopy('request', { eventId: ctx.eventId, eventName: ctx.eventName, actorName });
  await insertBells(ctx.admin, organizerProfileIds, ctx.actorProfileId, copy, { sport_event_id: ctx.eventId, sport_event_name: ctx.eventName, requester_profile_id: ctx.actorProfileId }, { action_status: 'pending' });
}

/** The organizer's decision (or a promotion) → the requester. */
export async function notifyDecision(ctx: BellContext, recipientProfileId: string, kind: 'approved' | 'rejected' | 'promoted'): Promise<void> {
  const actorName = await actorDisplayName(ctx.admin, ctx.actorProfileId);
  const copy = bellCopy(kind, { eventId: ctx.eventId, eventName: ctx.eventName, actorName });
  await insertBells(ctx.admin, [recipientProfileId], ctx.actorProfileId, copy, { sport_event_id: ctx.eventId, sport_event_name: ctx.eventName });
}

/** "Results are in" → every accepted participant (players and followers); the guardians of a supervised player get a copy. */
export async function notifyResults(admin: Admin, event: { id: string; name: string; format?: string }, actorProfileId: string): Promise<void> {
  try {
    const { data: rows } = await admin.from('sport_event_participants').select('profile_id, playing').eq('sport_event_id', event.id).eq('status', 'accepted');
    const all = (rows ?? []) as Array<{ profile_id: string; playing: boolean }>;
    const copy = bellCopy('results', { eventId: event.id, eventName: event.name, actorName: '', matchPlay: isMatchFormat(event.format) });
    const meta = { sport_event_id: event.id, sport_event_name: event.name };
    await insertBells(admin, all.map(r => r.profile_id), actorProfileId, copy, meta);
    const players = all.filter(r => r.playing).map(r => r.profile_id);
    if (players.length === 0) return;
    const { data: supervised } = await admin.from('profiles').select('id').in('id', players).eq('supervision_state', 'supervised');
    for (const child of supervised ?? []) {
      await notifyGuardians(admin, child.id as string, { type: 'sport_event_results', title: copy.title, message: copy.message, actionUrl: copy.action_url, actorId: actorProfileId, metadata: meta }, actorProfileId);
    }
  } catch (e) {
    console.error('[sport-events notify] results failed:', e);
  }
}
