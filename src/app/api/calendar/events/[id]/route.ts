import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { validateEventInput, validateGuestInput, MAX_GUESTS } from '@/lib/calendar/events';
import { applyWallTime, wallClockInZone, wallDurationMinutes } from '@/lib/calendar/recurrence';
import {
  notifyEventInvites,
  notifyEventUpdated,
  notifyEventCancelled,
  notifyGuestRemoved,
} from '@/lib/calendar/notifications';
import { formatEventWhen } from '@/lib/calendar/format-server';
import { loadEventForViewer } from '@/lib/calendar/detail-server';

// ── /api/calendar/events/[id] ─────────────────────────────────────────────────
// GET   → full detail (event + guest list + series rule when recurring).
//         Readable by the organizer and ANY guest row holder INCLUDING
//         declined (deep links must let a declined guest change their
//         mind). Everyone else: 404 — never reveal an event's existence.
// PATCH → organizer only. body.scope: 'this' (default) | 'following' |
//         'series'. Field edits skip overridden occurrences (except the
//         anchor); guest changes and cancellation never skip. Scoped TIME
//         edits keep each occurrence's own date and apply the new local
//         time (applyWallTime) — moving a repeating event to different
//         DAYS requires editing just that occurrence.
// DELETE→ organizer only: cancel. ?scope= as above; 'following'/'series'
//         bulk-cancel and stop generation (series ends flips to 'until').

const EVENT_FIELDS =
  'id, organizer_id, title, description, location, starts_at, ends_at, all_day, timezone, category, status, cancelled_at, series_id, series_override';
const GUEST_FIELDS =
  'id, profile_id, invited_email, role, status, responded_at, reminder_minutes, profiles:profile_id (id, first_name, middle_name, last_name, full_name, avatar_url, handle)';
const SERIES_FIELDS = 'id, freq, interval_n, byweekday, ends, until_at, count_n';

type Admin = ReturnType<typeof getSupabaseAdmin>;
type Scope = 'this' | 'following' | 'series';

function parseScope(raw: unknown): Scope | null {
  if (raw === undefined || raw === null || raw === '' || raw === 'this') return 'this';
  if (raw === 'following' || raw === 'series') return raw;
  return null;
}

async function fullDetail(admin: Admin, event: { id: string; series_id?: string | null } & object) {
  const { data: guests } = await admin
    .from('event_guests')
    .select(GUEST_FIELDS)
    .eq('event_id', event.id as string)
    .order('created_at', { ascending: true });
  let series = null;
  if (event.series_id) {
    const { data } = await admin
      .from('event_series')
      .select(SERIES_FIELDS)
      .eq('id', event.series_id as string)
      .maybeSingle();
    series = data ?? null;
  }
  return { ...event, guests: guests ?? [], series };
}

/** Occurrence rows of a series at/after an anchor (or all of them). */
async function seriesOccurrences(
  admin: Admin,
  seriesId: string,
  fromStartsAt: string | null
) {
  let query = admin
    .from('events')
    .select('id, starts_at, status, series_override')
    .eq('series_id', seriesId);
  if (fromStartsAt) query = query.gte('starts_at', fromStartsAt);
  const { data } = await query.order('starts_at', { ascending: true });
  return data ?? [];
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
    const scope = parseScope(body.scope);
    if (!scope) return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });
    if (scope !== 'this' && !event.series_id) {
      return NextResponse.json({ error: 'This event does not repeat' }, { status: 400 });
    }

    // Merge the incoming subset over the anchor, then re-validate the WHOLE
    // event — a partial edit can't bypass any invariant.
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

    const timeChanged =
      validated.event.starts_at !== event.starts_at ||
      validated.event.ends_at !== event.ends_at ||
      validated.event.all_day !== event.all_day;

    // Scoped time edits keep each occurrence's own DATE — refuse date moves.
    if (timeChanged && scope !== 'this') {
      const oldWall = wallClockInZone(Date.parse(event.starts_at), validated.event.timezone);
      const newWall = wallClockInZone(Date.parse(validated.event.starts_at), validated.event.timezone);
      if (oldWall.y !== newWall.y || oldWall.m !== newWall.m || oldWall.d !== newWall.d) {
        return NextResponse.json(
          { error: 'To move a repeating event to different days, edit just this event.' },
          { status: 400 }
        );
      }
    }

    // Target occurrence sets.
    let fieldTargets: { id: string; starts_at: string }[] = [{ id: event.id, starts_at: event.starts_at }];
    let guestTargetIds: string[] = [event.id];
    if (scope !== 'this' && event.series_id) {
      const from = scope === 'following' ? event.starts_at : null;
      const occurrences = await seriesOccurrences(admin, event.series_id, from);
      // Field edits: anchor always included; other occurrences only when
      // active and not individually overridden.
      fieldTargets = occurrences
        .filter(o => o.id === event.id || (o.status === 'active' && !o.series_override))
        .map(o => ({ id: o.id, starts_at: o.starts_at }));
      // Guest changes apply to every occurrence in range (override never skips).
      guestTargetIds = occurrences.map(o => o.id);
    }

    // ── Guest changes (validated against the anchor's roster) ──
    const { data: anchorGuests } = await admin
      .from('event_guests')
      .select('id, profile_id, invited_email, role, status')
      .eq('event_id', event.id);
    const guests = anchorGuests ?? [];

    const removeIds: string[] = Array.isArray(body.remove_guest_ids)
      ? body.remove_guest_ids.filter((g: unknown) => typeof g === 'string')
      : [];
    const removedRows = guests.filter(g => removeIds.includes(g.id));
    if (removedRows.some(g => g.role === 'organizer')) {
      return NextResponse.json({ error: 'The organizer cannot be removed.' }, { status: 400 });
    }
    const removedProfileIds = removedRows.map(g => g.profile_id).filter(Boolean) as string[];
    const removedEmails = removedRows.map(g => g.invited_email).filter(Boolean) as string[];

    const guestsValidated = validateGuestInput(
      body.add_guests ?? {},
      user.id,
      guests.length - removedRows.length - 1
    );
    if (!guestsValidated.ok) {
      return NextResponse.json({ error: guestsValidated.error }, { status: 400 });
    }
    const keptGuests = guests.filter(g => !removeIds.includes(g.id));
    const existingProfileIds = new Set(keptGuests.map(g => g.profile_id).filter(Boolean));
    const existingEmails = new Set(keptGuests.map(g => g.invited_email).filter(Boolean));
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

    const nonTimeChanged = (['title', 'description', 'location', 'category'] as const)
      .some(key => validated.event[key] !== (event as unknown as Record<string, unknown>)[key]);

    // ── Apply field edits ──
    const baseFields = {
      title: validated.event.title,
      description: validated.event.description,
      location: validated.event.location,
      category: validated.event.category,
      timezone: validated.event.timezone,
      all_day: validated.event.all_day,
    };
    if (timeChanged && scope !== 'this') {
      // Per-occurrence: keep its date, apply the new local time + duration.
      const newWall = wallClockInZone(Date.parse(validated.event.starts_at), validated.event.timezone);
      const durationMin = wallDurationMinutes(
        validated.event.starts_at, validated.event.ends_at, validated.event.timezone
      );
      for (const target of fieldTargets) {
        const times = applyWallTime(
          target.starts_at, validated.event.timezone,
          newWall.hh, newWall.mm, durationMin, validated.event.all_day
        );
        const { error } = await admin
          .from('events')
          .update({ ...baseFields, ...times })
          .eq('id', target.id);
        if (error) {
          console.error('[CALENDAR] scoped time update failed:', error);
          return NextResponse.json({ error: 'Could not save the event. Please try again.' }, { status: 500 });
        }
      }
    } else {
      const payload = scope === 'this'
        ? {
            ...baseFields,
            starts_at: validated.event.starts_at,
            ends_at: validated.event.ends_at,
            // An individually edited occurrence detaches from series-wide
            // FIELD edits (guest changes and cancellation still apply).
            ...(event.series_id ? { series_override: true } : {}),
          }
        : baseFields;
      const { error } = await admin
        .from('events')
        .update(payload)
        .in('id', fieldTargets.map(t => t.id));
      if (error) {
        console.error('[CALENDAR] event update failed:', error);
        return NextResponse.json({ error: 'Could not save the event. Please try again.' }, { status: 500 });
      }
    }

    // ── Apply guest changes across the guest-target range ──
    if (removedProfileIds.length > 0 || removedEmails.length > 0) {
      let del = admin.from('event_guests').delete().in('event_id', guestTargetIds).neq('role', 'organizer');
      if (removedProfileIds.length > 0 && removedEmails.length > 0) {
        del = del.or(
          `profile_id.in.(${removedProfileIds.join(',')}),invited_email.in.(${removedEmails.map(e => `"${e}"`).join(',')})`
        );
      } else if (removedProfileIds.length > 0) {
        del = del.in('profile_id', removedProfileIds);
      } else {
        del = del.in('invited_email', removedEmails);
      }
      const { error } = await del;
      if (error) console.error('[CALENDAR] guest removal failed:', error);
    }
    if (addProfileIds.length > 0 || addEmails.length > 0) {
      // Idempotent adds: skip occurrences where the identity already exists.
      const { data: existingRows } = await admin
        .from('event_guests')
        .select('event_id, profile_id, invited_email')
        .in('event_id', guestTargetIds);
      const has = new Set(
        (existingRows ?? []).map(r => `${r.event_id}:${r.profile_id ?? r.invited_email}`)
      );
      const rows = guestTargetIds.flatMap(eventId => [
        ...addProfileIds
          .filter(pid => !has.has(`${eventId}:${pid}`))
          .map(pid => ({ event_id: eventId, profile_id: pid, role: 'guest', status: 'invited' })),
        ...addEmails
          .filter(email => !has.has(`${eventId}:${email}`))
          .map(email => ({ event_id: eventId, invited_email: email, role: 'guest', status: 'invited' })),
      ]);
      if (rows.length > 0) {
        const { error } = await admin.from('event_guests').insert(rows);
        if (error) {
          console.error('[CALENDAR] guest add failed:', error);
          return NextResponse.json({ error: 'The event was saved but some guests could not be added.' }, { status: 500 });
        }
      }
    }

    // ── Best-effort fan-outs (ONE notification per guest, never per occurrence) ──
    const isSeriesOp = scope !== 'this' && !!event.series_id;
    const ctx = {
      supabase: admin,
      eventId: event.id,
      title: validated.event.title,
      series: isSeriesOp,
      seriesId: (event.series_id as string | null) ?? undefined,
    };
    if (nonTimeChanged || timeChanged) {
      const notify = keptGuests
        .filter(g => g.profile_id && g.role !== 'organizer' && g.status !== 'declined')
        .map(g => g.profile_id as string);
      await notifyEventUpdated(ctx, user.id, notify);
    }
    if (addProfileIds.length > 0) await notifyEventInvites(ctx, user.id, addProfileIds);
    if (removedProfileIds.length > 0) await notifyGuestRemoved(ctx, user.id, removedProfileIds);
    if (addEmails.length > 0 && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
      const { emailService } = await import('@/lib/email-service');
      const whenText = formatEventWhen(
        validated.event.starts_at, validated.event.ends_at, validated.event.all_day, validated.event.timezone
      );
      for (const email of addEmails) {
        try {
          await emailService.sendEventInvite(email, {
            organizerName: await actorDisplayName(admin, user.id),
            title: validated.event.title,
            whenText,
            timezone: validated.event.timezone,
            location: validated.event.location,
            description: validated.event.description,
          }, appUrl);
        } catch (e) {
          console.error('[CALENDAR] invite email failed:', e);
        }
      }
    }

    const { data: fresh } = await admin.from('events').select(EVENT_FIELDS).eq('id', event.id).single();
    return NextResponse.json({ event: await fullDetail(admin, fresh!) });
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
    const scope = parseScope(new URL(request.url).searchParams.get('scope'));
    if (!scope) return NextResponse.json({ error: 'Invalid scope' }, { status: 400 });

    const event = await loadEventForViewer(admin, id, user.id);
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (event.organizer_id !== user.id) {
      return NextResponse.json({ error: 'Only the organizer can cancel this event' }, { status: 403 });
    }
    if (scope !== 'this' && !event.series_id) {
      return NextResponse.json({ error: 'This event does not repeat' }, { status: 400 });
    }
    if (event.status === 'cancelled' && scope === 'this') {
      return NextResponse.json({ error: 'This event is already cancelled' }, { status: 409 });
    }

    // Cancellation NEVER skips overridden occurrences.
    let cancelIds = [event.id];
    if (scope !== 'this' && event.series_id) {
      const from = scope === 'following' ? event.starts_at : null;
      const occurrences = await seriesOccurrences(admin, event.series_id, from);
      cancelIds = occurrences.filter(o => o.status === 'active').map(o => o.id);
      if (cancelIds.length === 0) {
        return NextResponse.json({ error: 'This event is already cancelled' }, { status: 409 });
      }
    }

    const { error: cancelError } = await admin
      .from('events')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .in('id', cancelIds);
    if (cancelError) {
      console.error('[CALENDAR] cancel failed:', cancelError);
      return NextResponse.json({ error: 'Could not cancel the event. Please try again.' }, { status: 500 });
    }

    // Stop generation: any flip away from 'never' removes the series from
    // the cron's scan; until_at marks where the series now ends ('series'
    // scope pins it to the FIRST occurrence so nothing ever regenerates).
    if (scope !== 'this' && event.series_id) {
      let untilAt = event.starts_at;
      if (scope === 'series') {
        const { data: first } = await admin
          .from('events')
          .select('starts_at')
          .eq('series_id', event.series_id)
          .order('starts_at', { ascending: true })
          .limit(1)
          .maybeSingle();
        untilAt = first?.starts_at ?? event.starts_at;
      }
      const { error } = await admin
        .from('event_series')
        .update({ ends: 'until', until_at: untilAt })
        .eq('id', event.series_id);
      if (error) console.error('[CALENDAR] series stop failed:', error);
    }

    // ── Fan-out: ONE notification per distinct non-declined registered guest,
    // ONE email per distinct email invitee, across every affected occurrence. ──
    const { data: guests } = await admin
      .from('event_guests')
      .select('profile_id, invited_email, role, status')
      .in('event_id', cancelIds);
    const notify = [...new Set(
      (guests ?? [])
        .filter(g => g.profile_id && g.role !== 'organizer' && g.status !== 'declined')
        .map(g => g.profile_id as string)
    )];
    const emailGuests = [...new Set(
      (guests ?? []).filter(g => g.invited_email).map(g => g.invited_email as string)
    )];
    const ctx = {
      supabase: admin,
      eventId: event.id,
      title: event.title,
      series: scope !== 'this',
      seriesId: (event.series_id as string | null) ?? undefined,
    };
    await notifyEventCancelled(ctx, user.id, notify);
    if (emailGuests.length > 0 && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
      const { emailService } = await import('@/lib/email-service');
      const whenText = formatEventWhen(event.starts_at, event.ends_at, event.all_day, event.timezone);
      const organizerName = await actorDisplayName(admin, user.id);
      for (const email of emailGuests) {
        try {
          await emailService.sendEventCancelled(email, { organizerName, title: event.title, whenText }, appUrl);
        } catch (e) {
          console.error('[CALENDAR] cancel email failed:', e);
        }
      }
    }

    const { data: fresh } = await admin.from('events').select(EVENT_FIELDS).eq('id', event.id).single();
    return NextResponse.json({
      event: await fullDetail(admin, fresh!),
      cancelled_count: cancelIds.length,
    });
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
