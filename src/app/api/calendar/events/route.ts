import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { validateEventInput, validateGuestInput } from '@/lib/calendar/events';
import { notifyEventInvites } from '@/lib/calendar/notifications';
import { formatEventWhen } from '@/lib/calendar/format-server';

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
  'id, organizer_id, title, description, location, starts_at, ends_at, all_day, timezone, category, status, cancelled_at';

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
    return NextResponse.json({ events });
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

    const { data: event, error: eventError } = await admin
      .from('events')
      .insert({ ...validated.event, organizer_id: user.id })
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
