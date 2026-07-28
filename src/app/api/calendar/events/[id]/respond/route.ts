import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { notifyEventResponse } from '@/lib/calendar/notifications';

// ── POST /api/calendar/events/[id]/respond ────────────────────────────────────
// Accept / decline / maybe. Responses are changeable any number of times
// ("I said yes but now I can't make it"). The organizer's attendance is
// fixed; guests with no row on the event get a 404 (never reveal it).

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

    const admin = getSupabaseAdmin();
    const { data: guest } = await admin
      .from('event_guests')
      .select('id, role, status, events:event_id (id, organizer_id, title, status)')
      .eq('event_id', id)
      .eq('profile_id', user.id)
      .maybeSingle();
    if (!guest) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (guest.role === 'organizer') {
      return NextResponse.json({ error: "You're the organizer — your attendance is fixed." }, { status: 403 });
    }
    const event = guest.events as unknown as { id: string; organizer_id: string; title: string; status: string };
    if (event.status === 'cancelled') {
      return NextResponse.json({ error: 'This event was cancelled' }, { status: 409 });
    }

    const { data: updated, error } = await admin
      .from('event_guests')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', guest.id)
      .select('id, status, responded_at')
      .single();
    if (error || !updated) {
      console.error('[CALENDAR] respond failed:', error);
      return NextResponse.json({ error: 'Could not save your response. Please try again.' }, { status: 500 });
    }

    await notifyEventResponse(
      { supabase: admin, eventId: event.id, title: event.title },
      event.organizer_id,
      user.id,
      status as 'accepted' | 'declined' | 'maybe'
    );

    return NextResponse.json({ guest: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] respond error:', error);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
