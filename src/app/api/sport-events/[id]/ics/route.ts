import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { icsFilename, sportEventIcs } from '@/lib/sport-events/ics';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import type { SportEventRoundRow } from '@/lib/sport-events/types';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET /api/sport-events/[id]/ics?token= — "Add to calendar" (Events
 * program, phase 2b, B2): the event as one .ics with a VEVENT per
 * non-cancelled round. The SAME gate as the event view
 * (`readSportEventAccess`: public → everyone, link → the token or a
 * participant, private → a participant; a refusal is the same 404 as
 * not-found). Cookie-authed, so a plain <a href> works.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  const limited = await enforceRateLimit(request, 'sport-event-view');
  if (limited) return limited;
  try {
    const { user } = await getServerAuth(request);
    const url = new URL(request.url);
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, user?.id ?? null, url.searchParams.get('token'));
    if (!read) return NOT_FOUND();
    const { data } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', id).order('sequence', { ascending: true });
    const rounds = (data ?? []) as SportEventRoundRow[];
    const ics = sportEventIcs(read.event, rounds);
    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${icsFilename(read.event.name)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[api/sport-events/[id]/ics] GET error:', error);
    return NextResponse.json({ error: 'Could not build the calendar file' }, { status: 500 });
  }
}
