import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { validateEventInput, validateGuestInput, MAX_GUESTS } from '@/lib/calendar/events';
import {
  notifyEventInvites,
  notifyEventUpdated,
  notifyEventCancelled,
  notifyGuestRemoved,
} from '@/lib/calendar/notifications';
import { formatEventWhen } from '@/lib/calendar/format-server';

// ── /api/calendar/events/[id] ─────────────────────────────────────────────────
// GET   → full detail (event + guest list). Readable by the organizer and
//         ANY guest row holder INCLUDING declined (deep links must let a
//         declined guest change their mind). Everyone else: 404 — never
//         reveal an event's existence.
// PATCH → organizer only: edit fields, add/remove guests. 409 once cancelled.
// DELETE→ organizer only: cancel (status flip, never a row delete).

const EVENT_FIELDS =
  'id, organizer_id, title, description, location, starts_at, ends_at, all_day, timezone, category, status, cancelled_at';
const GUEST_FIELDS =
  'id, profile_id, invited_email, role, status, responded_at, profiles:profile_id (id, first_name, middle_name, last_name, full_name, avatar_url, handle)';

type Admin = ReturnType<typeof getSupabaseAdmin>;

async function loadEventForViewer(admin: Admin, eventId: string, viewerId: string) {
  const { data: event } = await admin
    .from('events')
    .select(EVENT_FIELDS)
    .eq('id', eventId)
    .maybeSingle();
  if (!event) return null;
  if (event.organizer_id !== viewerId) {
    const { data: myGuestRow } = await admin
      .from('event_guests')
      .select('id')
      .eq('event_id', eventId)
      .eq('profile_id', viewerId)
      .maybeSingle();
    if (!myGuestRow) return null;
  }
  return event;
}

async function fullDetail(admin: Admin, event: Record<string, unknown>) {
  const { data: guests } = await admin
    .from('event_guests')
    .select(GUEST_FIELDS)
    .eq('event_id', event.id as string)
    .order('created_at', { ascending: true });
  return { ...event, guests: guests ?? [] };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const admin = getSupabaseAdmin();
    const event = await loadEventForViewer(admin, id, user.id);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    return NextResponse.json({ event: await fullDetail(admin, event) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] detail error:', error);
    return NextResponse.json({ error: 'Could not load the event' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const admin = getSupabaseAdmin();

    const event = await loadEventForViewer(admin, id, user.id);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Only the organizer can edit this event' }, { status: 403 });
    }
    if (event.status === 'cancelled') {
      return NextResponse.json({ error: 'This event was cancelled' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));

    // Merge the incoming subset over the current fields, then re-validate
    // the WHOLE event — a partial edit can't bypass any invariant.
    const merged = {
      title: body.title ?? event.title,
      description: body.description !== undefined ? body.description : event.description,
      location: body.location !== undefined ? body.location : event.location,
      starts_at: body.starts_at ?? event.starts_at,
      ends_at: body.ends_at ?? event.ends_at,
      all_day: body.all_day !== undefined ? body.all_day : event.all_day,
      timezone: body.timezone ?? event.timezone,
      category: body.category ?? event.category,
    };
    const validated = validateEventInput(merged);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const { data: currentGuests } = await admin
      .from('event_guests')
      .select('id, profile_id, invited_email, role, status')
      .eq('event_id', id);
    const guests = currentGuests ?? [];

    // Guest removals (never the organizer row).
    const removeIds: string[] = Array.isArray(body.remove_guest_ids)
      ? body.remove_guest_ids.filter((g: unknown) => typeof g === 'string')
      : [];
    const removedRows = guests.filter(g => removeIds.includes(g.id));
    if (removedRows.some(g => g.role === 'organizer')) {
      return NextResponse.json({ error: 'The organizer cannot be removed.' }, { status: 400 });
    }

    // Guest additions (idempotent: skip anyone already on the event).
    const guestsValidated = validateGuestInput(
      body.add_guests ?? {},
      user.id,
      guests.length - removedRows.length - 1 // existing minus removals, organizer excluded
    );
    if (!guestsValidated.ok) {
      return NextResponse.json({ error: guestsValidated.error }, { status: 400 });
    }
    const existingProfileIds = new Set(guests.filter(g => !removeIds.includes(g.id)).map(g => g.profile_id).filter(Boolean));
    const existingEmails = new Set(guests.filter(g => !removeIds.includes(g.id)).map(g => g.invited_email).filter(Boolean));
    const addProfileIds = guestsValidated.guests.profileIds.filter(pid => !existingProfileIds.has(pid));
    const addEmails = guestsValidated.guests.emails.filter(e => !existingEmails.has(e));

    if (addProfileIds.length > 0) {
      const { data: found } = await admin.from('profiles').select('id').in('id', addProfileIds);
      if ((found ?? []).length !== addProfileIds.length) {
        return NextResponse.json({ error: 'One of the invited guests no longer exists.' }, { status: 400 });
      }
    }
    if (guests.length - removedRows.length - 1 + addProfileIds.length + addEmails.length > MAX_GUESTS) {
      return NextResponse.json({ error: `Events can have at most ${MAX_GUESTS} guests.` }, { status: 400 });
    }

    // Detect whether event fields actually changed (drives the update fan-out).
    const fieldsChanged = (Object.keys(validated.event) as (keyof typeof validated.event)[])
      .some(key => validated.event[key] !== (event as Record<string, unknown>)[key]);

    const { data: updated, error: updateError } = await admin
      .from('events')
      .update(validated.event)
      .eq('id', id)
      .select(EVENT_FIELDS)
      .single();
    if (updateError || !updated) {
      console.error('[CALENDAR] event update failed:', updateError);
      return NextResponse.json({ error: 'Could not save the event. Please try again.' }, { status: 500 });
    }

    if (removeIds.length > 0) {
      const { error } = await admin.from('event_guests').delete().in('id', removeIds).eq('event_id', id);
      if (error) console.error('[CALENDAR] guest removal failed:', error);
    }
    if (addProfileIds.length > 0 || addEmails.length > 0) {
      const { error } = await admin.from('event_guests').insert([
        ...addProfileIds.map(pid => ({ event_id: id, profile_id: pid, role: 'guest', status: 'invited' })),
        ...addEmails.map(email => ({ event_id: id, invited_email: email, role: 'guest', status: 'invited' })),
      ]);
      if (error) {
        console.error('[CALENDAR] guest add failed:', error);
        return NextResponse.json({ error: 'The event was saved but some guests could not be added.' }, { status: 500 });
      }
    }

    // Best-effort fan-outs.
    const ctx = { supabase: admin, eventId: id, title: updated.title };
    if (fieldsChanged) {
      const notify = guests
        .filter(g => g.profile_id && g.role !== 'organizer' && g.status !== 'declined' && !removeIds.includes(g.id))
        .map(g => g.profile_id as string);
      await notifyEventUpdated(ctx, user.id, notify);
    }
    if (addProfileIds.length > 0) await notifyEventInvites(ctx, user.id, addProfileIds);
    const removedProfileIds = removedRows.map(g => g.profile_id).filter(Boolean) as string[];
    if (removedProfileIds.length > 0) await notifyGuestRemoved(ctx, user.id, removedProfileIds);
    if (addEmails.length > 0 && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
      const { emailService } = await import('@/lib/email-service');
      const whenText = formatEventWhen(updated.starts_at, updated.ends_at, updated.all_day, updated.timezone);
      for (const email of addEmails) {
        try {
          await emailService.sendEventInvite(email, {
            organizerName: await actorDisplayName(admin, user.id),
            title: updated.title,
            whenText,
            timezone: updated.timezone,
            location: updated.location,
            description: updated.description,
          }, appUrl);
        } catch (e) {
          console.error('[CALENDAR] invite email failed:', e);
        }
      }
    }

    return NextResponse.json({ event: await fullDetail(admin, updated) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] update error:', error);
    Sentry.captureException(error, { tags: { area: 'calendar' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const admin = getSupabaseAdmin();

    const event = await loadEventForViewer(admin, id, user.id);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Only the organizer can cancel this event' }, { status: 403 });
    }
    if (event.status === 'cancelled') {
      return NextResponse.json({ error: 'This event is already cancelled' }, { status: 409 });
    }

    const { data: cancelled, error } = await admin
      .from('events')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', id)
      .select(EVENT_FIELDS)
      .single();
    if (error || !cancelled) {
      console.error('[CALENDAR] cancel failed:', error);
      return NextResponse.json({ error: 'Could not cancel the event. Please try again.' }, { status: 500 });
    }

    // Best-effort fan-out to non-declined guests + email invitees.
    const { data: guests } = await admin
      .from('event_guests')
      .select('profile_id, invited_email, role, status')
      .eq('event_id', id);
    const ctx = { supabase: admin, eventId: id, title: cancelled.title };
    const notify = (guests ?? [])
      .filter(g => g.profile_id && g.role !== 'organizer' && g.status !== 'declined')
      .map(g => g.profile_id as string);
    await notifyEventCancelled(ctx, user.id, notify);
    const emailGuests = (guests ?? []).filter(g => g.invited_email).map(g => g.invited_email as string);
    if (emailGuests.length > 0 && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
      const { emailService } = await import('@/lib/email-service');
      const whenText = formatEventWhen(cancelled.starts_at, cancelled.ends_at, cancelled.all_day, cancelled.timezone);
      const organizerName = await actorDisplayName(admin, user.id);
      for (const email of emailGuests) {
        try {
          await emailService.sendEventCancelled(email, { organizerName, title: cancelled.title, whenText }, appUrl);
        } catch (e) {
          console.error('[CALENDAR] cancel email failed:', e);
        }
      }
    }

    return NextResponse.json({ event: await fullDetail(admin, cancelled) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] cancel error:', error);
    Sentry.captureException(error, { tags: { area: 'calendar' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}

async function actorDisplayName(admin: Admin, profileId: string): Promise<string> {
  const { data } = await admin
    .from('profiles')
    .select('first_name, last_name, full_name')
    .eq('id', profileId)
    .maybeSingle();
  if (!data) return 'Someone';
  return [data.first_name, data.last_name].filter(Boolean).join(' ') || data.full_name || 'Someone';
}
