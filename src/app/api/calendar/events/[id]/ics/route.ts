import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { loadEventForViewer } from '@/lib/calendar/detail-server';
import { buildVEvent, buildCalendar } from '@/lib/calendar/ics';
import { describeRecurrence } from '@/lib/calendar/recurrence';
import { resolveEventRoutine } from '@/lib/calendar/event-routine';

// ── GET /api/calendar/events/[id]/ics ─────────────────────────────────────────
// "Add to calendar": downloads this event (this occurrence only, for
// recurring events — noted in the DESCRIPTION) as an .ics file. Same
// read gate as the detail route; cookie-authed, so a plain <a href>
// works client-side.

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
    const loaded = await loadEventForViewer(admin, id, user.id);
    if (!loaded) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    const event = loaded.event;

    let description = event.description ?? '';
    // Scheduled workout: name the routine in the exported description
    if (event.routine_id || event.routine_snapshot) {
      const routine = await resolveEventRoutine(admin, event);
      if (routine) {
        description = description ? `Workout: ${routine.name}\n\n${description}` : `Workout: ${routine.name}`;
      }
    }
    if (event.series_id) {
      const { data: rule } = await admin
        .from('event_series')
        .select('id, freq, interval_n, byweekday, ends, until_at, count_n')
        .eq('id', event.series_id)
        .maybeSingle();
      if (rule) {
        const note = `${describeRecurrence(rule, event.timezone)} (this file contains only this occurrence)`;
        description = description ? `${description}\n\n${note}` : note;
      }
    }

    const vevent = buildVEvent({
      uid: `${event.id}@edge-athlete`,
      dtstampMs: Date.parse(event.updated_at ?? event.starts_at),
      startMs: Date.parse(event.starts_at),
      endMs: Date.parse(event.ends_at),
      allDay: event.all_day,
      timezone: event.timezone,
      title: event.title,
      description: description || null,
      location: event.location,
      cancelled: event.status === 'cancelled',
    });
    const ics = buildCalendar([vevent]);
    const slug = event.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';

    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${slug}.ics"`,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] ics error:', error);
    return NextResponse.json({ error: 'Could not build the calendar file' }, { status: 500 });
  }
}
