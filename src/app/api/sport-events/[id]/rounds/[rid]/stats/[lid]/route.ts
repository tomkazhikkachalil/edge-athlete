import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { parseStatWrite, statSchemaFor } from '@/lib/sport-events/stats';
import { statEntryRight } from '@/lib/sport-events/stats-authz';
import { readStatLine, writeStatLine } from '@/lib/sport-events/stats-server';
import { shapeOf } from '@/lib/sport-events/types';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404 });

/**
 * PUT {stats, expected_version} — write ONE stat line whole (Events
 * program, phase 4). The right comes from the ROUND's status
 * (`statEntryRight`): live → an organizer, a named recorder, or the player
 * on their own line when the event has self entry (else 403
 * `recorder_only`); completed → organizers only; scheduled → 409. The
 * vocabulary is the sport's schema — a miss is a 400 by name, never
 * clamped. The write is a compare-and-set on `version`: a lost race is a
 * 409 carrying the line as the server holds it (`current`); the client
 * decides.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string; lid: string }> }) {
  const { id, rid, lid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(rid) || !UUID_RE.test(lid)) return NOT_FOUND();
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
    if (limited) return limited;
    const body = await readJson(request);
    const actor = await resolveActor(user.id, bodyProfileId(body));
    if (!actor.ok) return actor.response;

    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, actor.profileId, null);
    if (!read) return NOT_FOUND();
    const schema = statSchemaFor(read.event.sport_key);
    if (!schema || shapeOf(read.event) === 'round') return NextResponse.json({ error: 'This is a golf round — score its card.', reason: 'not_a_team_round' }, { status: 409 });
    const [{ data: round }, line, { data: own }] = await Promise.all([
      admin.from('sport_event_rounds').select('id, status').eq('id', rid).eq('sport_event_id', id).maybeSingle(),
      readStatLine(admin, lid),
      admin.from('sport_event_participants').select('id, status, recorder').eq('sport_event_id', id).eq('profile_id', actor.profileId).maybeSingle(),
    ]);
    if (!round || !line || line.sport_event_round_id !== rid) return NextResponse.json({ error: 'Line not found' }, { status: 404 });
    const recorder = !!own && own.status === 'accepted' && (own as { recorder?: boolean }).recorder === true;
    const right = statEntryRight({ viewerId: actor.profileId, ownerProfileId: line.profile_id, eventRole: read.access.role, recorder, selfEntry: read.event.self_entry !== false, roundStatus: round.status as 'scheduled' | 'live' | 'completed' | 'cancelled' });
    if (!right.allowed) return NextResponse.json({ error: right.error, ...(right.reason ? { reason: right.reason } : {}) }, { status: right.status });

    const { profile_id: _ignored, ...rest } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    void _ignored;
    const parsed = parseStatWrite(rest, schema);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const written = await writeStatLine(admin, lid, parsed.value.expected_version, parsed.value.stats, actor.profileId);
    if (written.outcome !== 'ok') {
      if (written.outcome === 'error') return NextResponse.json({ error: 'Could not save the stats' }, { status: 500 });
      const current = await readStatLine(admin, lid);
      return NextResponse.json({ error: 'Someone else changed this line.', reason: 'conflict', current: current ? { version: current.version, stats: current.stats } : null }, { status: 409 });
    }
    return NextResponse.json({ line: written.line, via: right.via }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/stats/line] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
