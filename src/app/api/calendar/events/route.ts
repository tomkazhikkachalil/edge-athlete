import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { validateEventInput, validateGuestInput } from '@/lib/calendar/events';
import { validateRecurrenceInput, describeRecurrence } from '@/lib/calendar/recurrence';
import { insertSeriesOccurrences } from '@/lib/calendar/series-server';
import { notifyEventInvites } from '@/lib/calendar/notifications';
import { formatEventWhen } from '@/lib/calendar/format-server';
import { buildRoutineSnapshot, type RoutinePlan } from '@/lib/calendar/event-routine';
import { fetchActivityOverlay } from '@/lib/calendar/activity-overlay';
import { checkSupervisedInviteGate } from '@/lib/calendar/supervised-invites';
import type { ServerRoutineRow } from '@/lib/workouts/routines';

// ── /api/calendar/events ──────────────────────────────────────────────────────
// GET ?from=&to= → the caller's calendar for a visible range: their guest
// rows (any status except declined) joined to active events. The organizer
// is a guest row too (role 'organizer'), so created + invited events come
// back from ONE query.
// POST → create an event + guest rows atomically (compensating delete on
// partial failure — workouts precedent), then best-effort notification +
// email fan-out.

const MAX_RANGE_DAYS = 62;

const EVENT_FIELDS =
  'id, organizer_id, title, description, location, starts_at, ends_at, all_day, timezone, category, status, cancelled_at, series_id, series_override, routine_id, routine_snapshot';

export async function GET(request: NextRequest) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const fromMs = Date.parse(searchParams.get('from') ?? '');
    const toMs = Date.parse(searchParams.get('to') ?? '');
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
    }
    if (toMs - fromMs > MAX_RANGE_DAYS * 86_400_000) {
      return NextResponse.json({ error: 'Date range too large' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    // True interval overlap: starts before the range ends AND ends after
    // the range starts (catches multi-day events spanning the boundary).
    const { data, error } = await admin
      .from('event_guests')
      .select(`status, role, events!inner(${EVENT_FIELDS})`)
      .eq('profile_id', user.id)
      .neq('status', 'declined')
      .eq('events.status', 'active')
      .lt('events.starts_at', new Date(toMs).toISOString())
      .gt('events.ends_at', new Date(fromMs).toISOString());
    if (error) throw error;

    const events = (data ?? []).map(row => {
      const event = row.events as unknown as Record<string, unknown>;
      return {
        ...event,
        my_status: row.status,
        is_organizer: row.role === 'organizer',
      };
    });

    // Completed-activity overlay (read-time, self-scoped, in-app only —
    // never in the ICS feed). A source-table failure must not take the
    // calendar down with it.
    let overlay: Awaited<ReturnType<typeof fetchActivityOverlay>> = [];
    try {
      overlay = await fetchActivityOverlay(admin, user.id, fromMs, toMs);
    } catch (e) {
      console.error('[CALENDAR] activity overlay failed:', e);
    }

    return NextResponse.json({ events: [...events, ...overlay] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] list error:', error);
    return NextResponse.json({ error: 'Could not load your calendar' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const body = await request.json().catch(() => ({}));

    const validated = validateEventInput(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }
    const guestsValidated = validateGuestInput(body.guests ?? {}, user.id);
    if (!guestsValidated.ok) {
      return NextResponse.json({ error: guestsValidated.error }, { status: 400 });
    }
    const { profileIds, emails } = guestsValidated.guests;

    const admin = getSupabaseAdmin();
    if (profileIds.length > 0) {
      const { data: found } = await admin
        .from('profiles')
        .select('id')
        .in('id', profileIds);
      const foundIds = new Set((found ?? []).map(p => p.id));
      const missing = profileIds.filter(id => !foundIds.has(id));
      if (missing.length > 0) {
        return NextResponse.json({ error: 'One of the invited guests no longer exists.' }, { status: 400 });
      }
    }

    // Supervised gate: invitees behind a family messaging tier, and no
    // raw-email guests from a supervised creator.
    const inviteGate = await checkSupervisedInviteGate(admin, user.id, profileIds, emails.length);
    if (!inviteGate.ok) {
      return NextResponse.json({ error: inviteGate.error }, { status: 403 });
    }

    // Attached routine: must be the caller's, snapshotted at attach time (the
    // frozen fallback for when the live routine is later deleted — 080).
    let routineSnapshot: RoutinePlan | null = null;
    if (validated.event.routine_id) {
      const { data: routineRow } = await admin
        .from('workout_routines')
        .select(
          `id, name, created_at, updated_at,
           exercises:workout_routine_exercises (
             name, exercise_key, category, position, notes, target_sets
           )`
        )
        .eq('id', validated.event.routine_id)
        .eq('profile_id', user.id)
        .maybeSingle();
      if (!routineRow) {
        return NextResponse.json({ error: 'That routine no longer exists.' }, { status: 400 });
      }
      routineSnapshot = buildRoutineSnapshot(routineRow as unknown as ServerRoutineRow);
    }

    // ── Recurring: series row → materialized occurrences + guest fan-out ──
    if (body.recurrence !== undefined && body.recurrence !== null) {
      const recValidated = validateRecurrenceInput(
        body.recurrence, validated.event.starts_at, validated.event.ends_at, validated.event.timezone
      );
      if (!recValidated.ok) {
        return NextResponse.json({ error: recValidated.error }, { status: 400 });
      }
      const { rule, occurrences } = recValidated;

      const { data: series, error: seriesError } = await admin
        .from('event_series')
        .insert({
          organizer_id: user.id,
          freq: rule.freq,
          interval_n: rule.interval_n,
          byweekday: rule.byweekday,
          ends: rule.ends,
          until_at: rule.until_at,
          count_n: rule.count_n,
          generated_until: occurrences[occurrences.length - 1].starts_at,
        })
        .select('id')
        .single();
      if (seriesError || !series) {
        console.error('[CALENDAR] series insert failed:', seriesError);
        return NextResponse.json({ error: 'Could not create the event. Please try again.' }, { status: 500 });
      }

      const now = new Date().toISOString();
      try {
        await insertSeriesOccurrences(
          admin,
          series.id,
          occurrences,
          {
            organizer_id: user.id,
            title: validated.event.title,
            description: validated.event.description,
            location: validated.event.location,
            all_day: validated.event.all_day,
            timezone: validated.event.timezone,
            category: validated.event.category,
            routine_id: validated.event.routine_id,
            routine_snapshot: routineSnapshot,
          },
          [
            { profile_id: user.id, role: 'organizer', status: 'accepted', responded_at: now },
            ...profileIds.map(id => ({ profile_id: id, role: 'guest', status: 'invited' })),
            ...emails.map(email => ({ invited_email: email, role: 'guest', status: 'invited' })),
          ]
        );
      } catch (e) {
        // Compensating delete — cascade wipes every occurrence + guest row.
        await admin.from('event_series').delete().eq('id', series.id);
        console.error('[CALENDAR] series materialization failed:', e);
        Sentry.captureException(e, { tags: { area: 'calendar' } });
        return NextResponse.json({ error: 'Nothing was saved — please try again.' }, { status: 500 });
      }

      const { data: firstEvent } = await admin
        .from('events')
        .select(EVENT_FIELDS)
        .eq('series_id', series.id)
        .order('starts_at', { ascending: true })
        .limit(1)
        .single();

      // ONE notification per guest for the whole series; ONE email per invitee.
      const ctx = {
        supabase: admin,
        eventId: firstEvent!.id,
        title: validated.event.title,
        series: true,
        seriesId: series.id,
      };
      await notifyEventInvites(ctx, user.id, profileIds);
      if (emails.length > 0 && process.env.SMTP_USER && process.env.SMTP_PASS) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
        const { emailService } = await import('@/lib/email-service');
        const organizerName = await organizerDisplayName(admin, user.id);
        const whenText = formatEventWhen(
          firstEvent!.starts_at, firstEvent!.ends_at, firstEvent!.all_day, firstEvent!.timezone
        );
        const recurrenceText = describeRecurrence(rule, validated.event.timezone);
        for (const email of emails) {
          try {
            await emailService.sendEventInvite(email, {
              organizerName,
              title: validated.event.title,
              whenText,
              timezone: validated.event.timezone,
              location: validated.event.location,
              description: validated.event.description,
              recurrenceText,
            }, appUrl);
          } catch (e) {
            console.error('[CALENDAR] invite email failed:', e);
          }
        }
      }

      return NextResponse.json(
        { event: firstEvent, occurrence_count: occurrences.length },
        { status: 201 }
      );
    }

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({ ...validated.event, routine_snapshot: routineSnapshot, organizer_id: user.id })
      .select(EVENT_FIELDS)
      .single();
    if (eventError || !event) {
      console.error('[CALENDAR] event insert failed:', eventError);
      return NextResponse.json({ error: 'Could not create the event. Please try again.' }, { status: 500 });
    }

    const guestRows = [
      {
        event_id: event.id,
        profile_id: user.id,
        role: 'organizer',
        status: 'accepted',
        responded_at: new Date().toISOString(),
      },
      ...profileIds.map(id => ({ event_id: event.id, profile_id: id, role: 'guest', status: 'invited' })),
      ...emails.map(email => ({ event_id: event.id, invited_email: email, role: 'guest', status: 'invited' })),
    ];
    const { error: guestError } = await admin.from('event_guests').insert(guestRows);
    if (guestError) {
      // Compensating delete — no silent partial state (workouts precedent).
      await admin.from('events').delete().eq('id', event.id);
      console.error('[CALENDAR] guest insert failed:', guestError);
      Sentry.captureException(new Error(`calendar: guest insert failed: ${guestError.message}`));
      return NextResponse.json({ error: 'Nothing was saved — please try again.' }, { status: 500 });
    }

    // Best-effort fan-out: never fails the create.
    const ctx = { supabase: admin, eventId: event.id, title: event.title };
    await notifyEventInvites(ctx, user.id, profileIds);
    if (emails.length > 0 && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
      const { emailService } = await import('@/lib/email-service');
      const organizerName = await organizerDisplayName(admin, user.id);
      const whenText = formatEventWhen(event.starts_at, event.ends_at, event.all_day, event.timezone);
      for (const email of emails) {
        try {
          await emailService.sendEventInvite(email, {
            organizerName,
            title: event.title,
            whenText,
            timezone: event.timezone,
            location: event.location,
            description: event.description,
          }, appUrl);
        } catch (e) {
          console.error('[CALENDAR] invite email failed:', e);
        }
      }
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] create error:', error);
    Sentry.captureException(error, { tags: { area: 'calendar' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}

async function organizerDisplayName(
  admin: ReturnType<typeof getSupabaseAdmin>,
  profileId: string
): Promise<string> {
  const { data } = await admin
    .from('profiles')
    .select('first_name, last_name, full_name')
    .eq('id', profileId)
    .maybeSingle();
  if (!data) return 'Someone';
  return [data.first_name, data.last_name].filter(Boolean).join(' ') || data.full_name || 'Someone';
}
