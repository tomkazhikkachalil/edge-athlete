import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { isValidReminderMinutes } from '@/lib/calendar/reminders';

// ── POST /api/calendar/events/[id]/reminder ───────────────────────────────────
// Per-event, per-guest reminder lead (presets only; 0 = off). Changing the
// value clears reminded_at, so widening the lead inside the new window
// re-reminds once — "remind me 1 day before" set 2 hours out should fire.
// For recurring events this applies to THIS occurrence's guest row only.

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
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const minutes = body.minutes;
    if (!isValidReminderMinutes(minutes)) {
      return NextResponse.json({ error: 'Invalid reminder setting.' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { data: guest } = await admin
      .from('event_guests')
      .select('id, reminder_minutes, events:event_id (status)')
      .eq('event_id', id)
      .eq('profile_id', user.id)
      .maybeSingle();
    if (!guest) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    const event = guest.events as unknown as { status: string };
    if (event.status === 'cancelled') {
      return NextResponse.json({ error: 'This event was cancelled' }, { status: 409 });
    }

    if (guest.reminder_minutes === minutes) {
      return NextResponse.json({ guest: { id: guest.id, reminder_minutes: minutes } });
    }
    const { data: updated, error } = await admin
      .from('event_guests')
      .update({ reminder_minutes: minutes, reminded_at: null })
      .eq('id', guest.id)
      .select('id, reminder_minutes')
      .single();
    if (error || !updated) {
      console.error('[CALENDAR] reminder update failed:', error);
      return NextResponse.json({ error: 'Could not save your reminder. Please try again.' }, { status: 500 });
    }
    return NextResponse.json({ guest: updated });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] reminder error:', error);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
