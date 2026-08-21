import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { notifyEventResponse } from '@/lib/calendar/notifications';

// ── POST /api/calendar/events/[id]/respond ────────────────────────────────────
// Accept / decline / maybe. Responses are changeable any number of times
// ("I said yes but now I can't make it"). The organizer's attendance is
// fixed; guests with no row on the event get a 404 (never reveal it).
// body.scope: 'this' (default — per-occurrence decline is exactly this) |
// 'series' (update the caller's rows on every ACTIVE occurrence; one
// organizer notification with series wording).

const VALID = new Set(['accepted', 'declined', 'maybe']);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const status = typeof body.status === 'string' ? body.status : '';
    if (!VALID.has(status)) {
      return NextResponse.json({ error: "status must be 'accepted', 'declined', or 'maybe'" }, { status: 400 });
    }

    const scope = body.scope === 'series' ? 'series' : 'this';

    const admin = getSupabaseAdmin();

    // Round I: a guardian may respond on their managed athlete's behalf via
    // targetProfileId — the console's "Decline" on a child's invite. The
    // guest row stays the CHILD's (attribution doctrine: the child is the
    // invitee; the organizer sees the child's response).
    let respondAs = user.id;
    if (
      typeof body.targetProfileId === 'string' &&
      body.targetProfileId &&
      body.targetProfileId !== user.id
    ) {
      const role = await getProfileRole(user.id, body.targetProfileId);
      if (role !== 'guardian') {
        return NextResponse.json(
          { error: 'You do not have permission to respond for this athlete' },
          { status: 403 }
        );
      }
      respondAs = body.targetProfileId;
    }

    const { data: guest } = await admin
      .from('event_guests')
      .select('id, role, status, events:event_id (id, organizer_id, title, status, series_id)')
      .eq('event_id', id)
      .eq('profile_id', respondAs)
      .maybeSingle();
    if (!guest) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (guest.role === 'organizer') {
      return NextResponse.json({ error: "You're the organizer — your attendance is fixed." }, { status: 403 });
    }
    const event = guest.events as unknown as {
      id: string; organizer_id: string; title: string; status: string; series_id: string | null;
    };
    if (event.status === 'cancelled') {
      return NextResponse.json({ error: 'This event was cancelled' }, { status: 409 });
    }
    if (scope === 'series' && !event.series_id) {
      return NextResponse.json({ error: 'This event does not repeat' }, { status: 400 });
    }

    let updated: { id: string; status: string; responded_at: string | null } | null = null;
    let updatedCount = 1;
    if (scope === 'series' && event.series_id) {
      // The caller's rows across every ACTIVE occurrence of the series.
      const { data: occurrences } = await admin
        .from('events')
        .select('id')
        .eq('series_id', event.series_id)
        .eq('status', 'active');
      const occurrenceIds = (occurrences ?? []).map(o => o.id);
      const { data: rows, error } = await admin
        .from('event_guests')
        .update({ status, responded_at: new Date().toISOString() })
        .in('event_id', occurrenceIds)
        .eq('profile_id', respondAs)
        .neq('role', 'organizer')
        .select('id, status, responded_at, event_id');
      if (error || !rows?.length) {
        console.error('[CALENDAR] series respond failed:', error);
        return NextResponse.json({ error: 'Could not save your response. Please try again.' }, { status: 500 });
      }
      updatedCount = rows.length;
      updated = rows.find(r => r.event_id === id) ?? rows[0];
    } else {
      const { data: row, error } = await admin
        .from('event_guests')
        .update({ status, responded_at: new Date().toISOString() })
        .eq('id', guest.id)
        .select('id, status, responded_at')
        .single();
      if (error || !row) {
        console.error('[CALENDAR] respond failed:', error);
        return NextResponse.json({ error: 'Could not save your response. Please try again.' }, { status: 500 });
      }
      updated = row;
    }

    await notifyEventResponse(
      {
        supabase: admin,
        eventId: event.id,
        title: event.title,
        series: scope === 'series',
        seriesId: event.series_id ?? undefined,
      },
      event.organizer_id,
      respondAs,
      status as 'accepted' | 'declined' | 'maybe'
    );

    return NextResponse.json({ guest: updated, updated_count: updatedCount });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] respond error:', error);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
