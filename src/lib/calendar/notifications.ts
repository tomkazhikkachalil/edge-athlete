// ── Calendar notification fan-out ────────────────────────────────────────────
// The invite → pending → respond → tally loop only works if each step
// notifies the right people. All senders are BEST-EFFORT: a failed
// notification never fails the calendar action itself.
//
// Types (migration 057): event_invite / event_update / event_cancelled /
// event_response are inserted DIRECTLY (create_notification's preference
// gate has no branch for them and would silently drop them — the
// new_message / group_invite precedent). Titles are frozen text: the
// NotificationBell default branch renders them with no client changes.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

async function actorName(supabase: Admin, profileId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('first_name, last_name, full_name')
    .eq('id', profileId)
    .maybeSingle();
  if (!data) return 'Someone';
  return (
    [data.first_name, data.last_name].filter(Boolean).join(' ') ||
    data.full_name ||
    'Someone'
  );
}

export interface EventNotifyContext {
  supabase: Admin;
  eventId: string; // anchor occurrence for deep links
  title: string;   // event title
  series?: boolean; // series-wide operation → series wording, ONE notification per guest
  seriesId?: string;
}

const eventUrl = (eventId: string) => `/calendar?event=${eventId}`;
const seriesMeta = (ctx: EventNotifyContext) =>
  ctx.seriesId ? { series_id: ctx.seriesId } : {};

/** Invitations: notify every invited registered guest (never the organizer). */
export async function notifyEventInvites(
  ctx: EventNotifyContext,
  organizerId: string,
  invitedProfileIds: string[]
): Promise<void> {
  try {
    const recipients = [...new Set(invitedProfileIds)].filter(id => id !== organizerId);
    if (recipients.length === 0) return;
    const name = await actorName(ctx.supabase, organizerId);
    const rows = recipients.map(id => ({
      user_id: id,
      type: 'event_invite',
      actor_id: organizerId,
      title: ctx.series
        ? `${name} invited you to a recurring event`
        : `${name} invited you to an event`,
      message: ctx.title,
      action_url: eventUrl(ctx.eventId),
      is_read: false,
      metadata: { event_id: ctx.eventId, ...seriesMeta(ctx) },
    }));
    const { error } = await ctx.supabase.from('notifications').insert(rows);
    if (error) console.error('[CALENDAR NOTIFY] invite fan-out failed:', error);

    // Round I: an event invite reaching a SUPERVISED athlete also bells
    // their guardians — real-world times and places are exactly what a
    // parent wants to know about. The inviter already passed the family's
    // messaging tier (checkSupervisedInviteGate); this is the awareness
    // half. Actor excluded, so a guardian's own invite reaches only
    // co-guardians. Best-effort.
    const { data: supervisedInvitees } = await ctx.supabase
      .from('profiles')
      .select('id, first_name')
      .in('id', recipients)
      .eq('supervision_state', 'supervised');
    if (supervisedInvitees && supervisedInvitees.length > 0) {
      const { notifyGuardians } = await import('@/lib/guardian-notify');
      for (const child of supervisedInvitees) {
        await notifyGuardians(ctx.supabase, child.id, {
          type: 'calendar_alert',
          title: `${name} invited ${child.first_name || 'your athlete'} to an event`,
          message: ctx.title,
          actionUrl: `/app/guardian/athlete/${child.id}`,
          actorId: organizerId,
          metadata: { event_id: ctx.eventId, ...seriesMeta(ctx) },
        }, organizerId);
      }
    }
  } catch (e) {
    console.error('[CALENDAR NOTIFY] invite fan-out failed:', e);
  }
}

/** Event details changed: notify every non-declined registered guest. */
export async function notifyEventUpdated(
  ctx: EventNotifyContext,
  organizerId: string,
  guestProfileIds: string[]
): Promise<void> {
  try {
    const recipients = [...new Set(guestProfileIds)].filter(id => id !== organizerId);
    if (recipients.length === 0) return;
    const name = await actorName(ctx.supabase, organizerId);
    const rows = recipients.map(id => ({
      user_id: id,
      type: 'event_update',
      actor_id: organizerId,
      title: ctx.series
        ? `${name} updated a recurring event you're invited to`
        : `${name} updated an event you're invited to`,
      message: ctx.title,
      action_url: eventUrl(ctx.eventId),
      is_read: false,
      metadata: { event_id: ctx.eventId, kind: 'details_changed', ...seriesMeta(ctx) },
    }));
    const { error } = await ctx.supabase.from('notifications').insert(rows);
    if (error) console.error('[CALENDAR NOTIFY] update fan-out failed:', error);
  } catch (e) {
    console.error('[CALENDAR NOTIFY] update fan-out failed:', e);
  }
}

/** Cancellation: notify every non-declined registered guest. */
export async function notifyEventCancelled(
  ctx: EventNotifyContext,
  organizerId: string,
  guestProfileIds: string[]
): Promise<void> {
  try {
    const recipients = [...new Set(guestProfileIds)].filter(id => id !== organizerId);
    if (recipients.length === 0) return;
    const name = await actorName(ctx.supabase, organizerId);
    const rows = recipients.map(id => ({
      user_id: id,
      type: 'event_cancelled',
      actor_id: organizerId,
      title: ctx.series
        ? `${name} cancelled a recurring event`
        : `${name} cancelled an event`,
      message: ctx.title,
      action_url: eventUrl(ctx.eventId),
      is_read: false,
      metadata: { event_id: ctx.eventId, ...seriesMeta(ctx) },
    }));
    const { error } = await ctx.supabase.from('notifications').insert(rows);
    if (error) console.error('[CALENDAR NOTIFY] cancel fan-out failed:', error);
  } catch (e) {
    console.error('[CALENDAR NOTIFY] cancel fan-out failed:', e);
  }
}

/** RSVP: tell the organizer someone responded. */
export async function notifyEventResponse(
  ctx: EventNotifyContext,
  organizerId: string,
  responderId: string,
  status: 'accepted' | 'declined' | 'maybe'
): Promise<void> {
  try {
    if (responderId === organizerId) return;
    const name = await actorName(ctx.supabase, responderId);
    const noun = ctx.series ? 'your recurring event' : 'your event';
    const titleText =
      status === 'accepted' ? `${name} is going to ${noun}`
      : status === 'declined' ? `${name} declined ${noun}`
      : `${name} might come to ${noun}`;
    const { error } = await ctx.supabase.from('notifications').insert({
      user_id: organizerId,
      type: 'event_response',
      actor_id: responderId,
      title: titleText,
      message: ctx.title,
      action_url: eventUrl(ctx.eventId),
      is_read: false,
      metadata: { event_id: ctx.eventId, response: status, ...seriesMeta(ctx) },
    });
    if (error) console.error('[CALENDAR NOTIFY] response failed:', error);
  } catch (e) {
    console.error('[CALENDAR NOTIFY] response failed:', e);
  }
}

/** Guest removed by the organizer: they can no longer open the event, so
 *  no deep link. */
export async function notifyGuestRemoved(
  ctx: EventNotifyContext,
  organizerId: string,
  removedProfileIds: string[]
): Promise<void> {
  try {
    const recipients = [...new Set(removedProfileIds)].filter(id => id !== organizerId);
    if (recipients.length === 0) return;
    const name = await actorName(ctx.supabase, organizerId);
    const rows = recipients.map(id => ({
      user_id: id,
      type: 'event_update',
      actor_id: organizerId,
      title: `${name} removed you from an event`,
      message: ctx.title,
      action_url: null,
      is_read: false,
      metadata: { event_id: ctx.eventId, kind: 'guest_removed' },
    }));
    const { error } = await ctx.supabase.from('notifications').insert(rows);
    if (error) console.error('[CALENDAR NOTIFY] removal fan-out failed:', error);
  } catch (e) {
    console.error('[CALENDAR NOTIFY] removal fan-out failed:', e);
  }
}
