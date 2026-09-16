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
 * Phase 4: `sport_event_live` is SENT — to every accepted FOLLOWER when a
 * round goes live (players are playing; the results bell reaches everyone),
 * once per round (dedupe on the bell's metadata, the reminder's pattern),
 * no actor (the 213 lesson).
 */
import { matchClosedLine, matchSetLine, matchSetRecipients, type DrawGroupForBells } from './match-bells';
import type { RoundMatch } from './match-server';
import { isMatchFormat } from './types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyGuardians } from '@/lib/guardian-notify';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export type SportEventBell = 'sport_event_invite' | 'sport_event_request' | 'sport_event_request_decision' | 'sport_event_results' | 'sport_event_reminder' | 'sport_event_match' | 'sport_event_live';

export interface BellCopy {
  type: SportEventBell;
  title: string;
  message: string | null;
  action_url: string;
}

export function eventPath(eventId: string, tab?: 'players' | 'leaderboard' | 'overview' | 'matches', roundId?: string | null): string {
  if (!tab) return `/events/${eventId}`;
  return roundId ? `/events/${eventId}?tab=${tab}&round=${roundId}` : `/events/${eventId}?tab=${tab}`;
}

/** Phase 3 (213): the match bells' copy — one type, three kinds; `line` is match-bells.ts's. */
export function matchBellCopy(kind: 'set' | 'won' | 'lost', ctx: { eventId: string; eventName: string; roundId: string; line: string }): BellCopy {
  const title = `${ctx.line} in ${ctx.eventName}`;
  const message = kind === 'set' ? 'Your match is set — see the draw.' : kind === 'won' ? 'Well played — see how the round ended.' : 'See how the round ended.';
  return { type: 'sport_event_match', title, message, action_url: eventPath(ctx.eventId, 'matches', ctx.roundId) };
}

export function bellCopy(
  kind: 'invite' | 'request' | 'approved' | 'rejected' | 'promoted' | 'results' | 'live',
  ctx: { eventId: string; eventName: string; actorName: string; matchPlay?: boolean; roundId?: string; roundLabel?: string | null },
): BellCopy {
  switch (kind) {
    case 'live':
      return {
        type: 'sport_event_live',
        title: `Live now: ${ctx.eventName}${ctx.roundLabel ? ` · ${ctx.roundLabel}` : ''}`,
        message: ctx.matchPlay ? 'Follow the matches as they happen.' : 'Follow the leaderboard as the scores come in.',
        action_url: eventPath(ctx.eventId, ctx.matchPlay ? 'matches' : 'leaderboard', ctx.roundId ?? null),
      };
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

/** Display names for a set of profiles (first + last, else the display / full name) — the bells' voice. */
async function namesFor(admin: Admin, profileIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (profileIds.length === 0) return out;
  const { data } = await admin.from('profiles').select('id, first_name, last_name, full_name, display_name').in('id', profileIds);
  for (const p of (data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; full_name: string | null; display_name: string | null }>) {
    out.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.display_name || p.full_name || 'Someone');
  }
  return out;
}

/**
 * Phase 3 (213): "You play Bob" — every member of a complete match whose
 * match changed with this save of the draw (a re-save bells nobody). The
 * sender is 23514-tolerant: before 213 ran it logs and stops.
 */
export async function notifyMatchSet(admin: Admin, event: { id: string; name: string }, roundId: string, previous: ReadonlyArray<DrawGroupForBells>, next: ReadonlyArray<DrawGroupForBells>, participantProfile: ReadonlyMap<string, string>, actorProfileId: string): Promise<void> {
  try {
    const recipients = matchSetRecipients(previous, next);
    if (recipients.length === 0) return;
    const names = await namesFor(admin, [...new Set([...participantProfile.values()])]);
    const nameOf = (participantId: string) => names.get(participantProfile.get(participantId) ?? '') ?? 'Someone';
    for (const r of recipients) {
      const profileId = participantProfile.get(r.participant_id);
      if (!profileId) continue;
      const copy = matchBellCopy('set', { eventId: event.id, eventName: event.name, roundId, line: matchSetLine(r.partner.map(nameOf), r.opponents.map(nameOf)) });
      // No actor: the member is the subject, and insertBells never bells the actor — an organizer who plays must still get theirs.
      const { error } = await insertBells(admin, [profileId], null, copy, { sport_event_id: event.id, sport_event_round_id: roundId, kind: 'set', set_by: actorProfileId });
      if (error?.code === '23514') { console.warn('[sport-events notify] sport_event_match is not in the type CHECK — run migration 213'); return; }
    }
  } catch (e) {
    console.error('[sport-events notify] match set failed:', e);
  }
}

/** Phase 3 (213): "You beat Bob 3&2" / "Bob beat you 3&2" — each member of a decided match at the round's completion; a bye bells nobody. 23514-tolerant. */
export async function notifyMatchClosed(admin: Admin, event: { id: string; name: string }, roundId: string, matches: ReadonlyArray<RoundMatch>, actorProfileId: string): Promise<void> {
  try {
    // The bells speak in full names (the invite's "Edge Alpha invited you"), never the view's masked ones — the members already know each other.
    const names = await namesFor(admin, [...new Set(matches.flatMap(m => m.sides.flatMap(s => s.members.map(x => x.profile_id))))]);
    const nameOf = (x: { profile_id: string; name: string }) => names.get(x.profile_id) ?? x.name;
    for (const m of matches) {
      const w = m.state.winnerSide;
      if (!w || m.bye) continue;
      for (const side of m.sides) {
        const won = side.side === w;
        const other = m.sides[side.side === 1 ? 1 : 0];
        for (const member of side.members) {
          const partner = side.members.filter(x => x.participant_id !== member.participant_id).map(nameOf);
          const copy = matchBellCopy(won ? 'won' : 'lost', { eventId: event.id, eventName: event.name, roundId, line: matchClosedLine(won, partner, other.members.map(nameOf), m.state.result) });
          const { error } = await insertBells(admin, [member.profile_id], null, copy, { sport_event_id: event.id, sport_event_round_id: roundId, sport_event_match_id: m.id, kind: won ? 'won' : 'lost', completed_by: actorProfileId });
          if (error?.code === '23514') { console.warn('[sport-events notify] sport_event_match is not in the type CHECK — run migration 213'); return; }
        }
      }
    }
  } catch (e) {
    console.error('[sport-events notify] match closed failed:', e);
  }
}

/**
 * Phase 4: the live bell — every accepted FOLLOWER of the event when a round
 * goes live, once per round (query-before-insert on `metadata.
 * sport_event_round_id`), no actor. Best-effort; 23514-tolerant like every
 * sender (the type has been in the CHECK since 205).
 */
export async function notifyLive(admin: Admin, event: { id: string; name: string; format?: string }, round: { id: string; sequence: number; name?: string | null }, roundCount: number): Promise<void> {
  try {
    const [{ data: rows }, { data: sent }] = await Promise.all([
      admin.from('sport_event_participants').select('profile_id').eq('sport_event_id', event.id).eq('status', 'accepted').eq('role', 'follower').limit(1000),
      admin.from('notifications').select('user_id').eq('type', 'sport_event_live').contains('metadata', { sport_event_round_id: round.id }).limit(1000),
    ]);
    const already = new Set(((sent ?? []) as Array<{ user_id: string }>).map(n => n.user_id));
    const recipients = ((rows ?? []) as Array<{ profile_id: string }>).map(r => r.profile_id).filter(id => !already.has(id));
    if (recipients.length === 0) return;
    const roundLabel = roundCount > 1 ? (round.name?.trim() || `Round ${round.sequence}`) : null;
    const copy = bellCopy('live', { eventId: event.id, eventName: event.name, actorName: '', matchPlay: isMatchFormat(event.format), roundId: round.id, roundLabel });
    const result = await insertBells(admin, recipients, null, copy, { sport_event_id: event.id, sport_event_round_id: round.id, sport_event_name: event.name });
    if (result.error?.code === '23514') console.warn('[sport-events notify] sport_event_live is not in the type CHECK');
  } catch (e) {
    console.error('[sport-events notify] live failed:', e);
  }
}
