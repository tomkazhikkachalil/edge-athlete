import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { applyTransition } from '@/lib/sport-events/lifecycle-server';
import { SPORT_EVENT_STATUSES, type SportEventStatus } from '@/lib/sport-events/types';
import { isDateOnly } from '@/lib/sport-events/validate';
import { fetchSportEventView } from '@/lib/sport-events/view-server';

/**
 * POST {to, override?, today?} — the organizer's intent: open (mints the
 * announce post), live (mints the round), completed (finalizes, mirrors,
 * re-timestamps the post), cancelled. A refusal is a 409 with a named
 * `reason` (lifecycle.ts). Organizers only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
    if (limited) return limited;
    const body = await readJson(request);
    const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const to = b.to;
    if (typeof to !== 'string' || !(SPORT_EVENT_STATUSES as readonly string[]).includes(to) || to === 'draft') return NextResponse.json({ error: 'to must be one of open, live, completed, cancelled' }, { status: 400 });
    if (b.override !== undefined && typeof b.override !== 'boolean') return NextResponse.json({ error: 'override must be true or false' }, { status: 400 });
    if (b.today !== undefined && b.today !== null && !isDateOnly(b.today)) return NextResponse.json({ error: 'today must be a date (YYYY-MM-DD)' }, { status: 400 });
    const actor = await resolveActor(user.id, bodyProfileId(body));
    if (!actor.ok) return actor.response;

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can change the event.' }, { status: 403 });

    const outcome = await applyTransition(admin, { eventId: id, to: to as SportEventStatus, actorProfileId: actor.profileId, override: b.override === true, today: typeof b.today === 'string' ? b.today : null });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error, reason: outcome.reason }, { status: outcome.status });
    const view = await fetchSportEventView(admin, id, actor.profileId, null);
    return NextResponse.json(view, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/transition] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
