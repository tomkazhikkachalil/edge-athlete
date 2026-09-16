import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { bodyProfileId, readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { readFormatConfig, readMatchConfig } from '@/lib/sport-events/format-config';
import { validateGroupsPlan } from '@/lib/sport-events/groups';
import { sidesOf } from '@/lib/sport-events/match';
import { readRoundGroups, type RoundGroup } from '@/lib/sport-events/match-server';
import { notifyMatchSet } from '@/lib/sport-events/notify';
import type { DrawGroupForBells } from '@/lib/sport-events/match-bells';
import { fetchSportEventView } from '@/lib/sport-events/view-server';
import { shapeOf } from '@/lib/sport-events/types';

/**
 * PUT {groups: [{name?, tee_time?, starting_hole?, members: [participantId | {participant_id, side}]}]}
 * — replace the round's whole grouping (organizers, while THE ROUND is scheduled). Every
 * member must be an accepted, playing participant; nobody in two groups.
 * The mint reads these at go-live to order the round's players. Phase 3
 * (212): on a match format every member gets a `side` (1 | 2 — sent, or
 * derived from the position for a plain id); on a stroke format a `side`
 * is refused by name. The `set` bell (213) goes to every member of a
 * complete match whose match changed with this save.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(rid)) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
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
    if (!read) return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can set the groups.' }, { status: 403 });
    const { data: round } = await admin.from('sport_event_rounds').select('id, status').eq('id', rid).eq('sport_event_id', id).maybeSingle();
    if (!round) return NextResponse.json({ error: 'Round not found' }, { status: 404 });
    // Phase 2: the gate is the ROUND's — round 2 is regrouped while round 1 is live.
    if (round.status !== 'scheduled') return NextResponse.json({ error: 'Groups are set before the round starts.' }, { status: 409 });

    const { data: eligible } = await admin.from('sport_event_participants').select('id, profile_id').eq('sport_event_id', id).eq('status', 'accepted').eq('playing', true);
    const match = readMatchConfig(readFormatConfig(read.event.format_config, 8, read.event.format), read.event.format);
    // Phase 4: a GAME's groups carry sides too (the two ad-hoc sides; any size; sent, never derived).
    const plan = validateGroupsPlan(body, new Set(((eligible ?? []) as Array<{ id: string }>).map(r => r.id)), { sides: match?.sides ?? null, game: shapeOf(read.event) === 'game' });
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

    const previous: RoundGroup[] = match ? await readRoundGroups(admin, rid) : [];
    const { error: clearError } = await admin.from('sport_event_groups').delete().eq('sport_event_round_id', rid);
    if (clearError) {
      console.error('[api/sport-events/groups] clear failed:', clearError);
      return NextResponse.json({ error: 'Could not save the groups' }, { status: 500 });
    }
    for (const g of plan.value) {
      const { data: inserted, error } = await admin.from('sport_event_groups').insert({ sport_event_round_id: rid, sequence: g.sequence, name: g.name, tee_time: g.tee_time, starting_hole: g.starting_hole }).select('id').single();
      if (error || !inserted) {
        console.error('[api/sport-events/groups] group insert failed:', error);
        return NextResponse.json({ error: 'Could not save the groups' }, { status: 500 });
      }
      if (g.members.length > 0) {
        const { error: memberError } = await admin.from('sport_event_group_members').insert(g.members.map(m => ({ group_id: inserted.id, sport_event_round_id: rid, participant_id: m.participant_id, position: m.position, side: m.side })));
        if (memberError) {
          console.error('[api/sport-events/groups] member insert failed:', memberError);
          return NextResponse.json({ error: 'Could not save the groups' }, { status: 500 });
        }
      }
    }
    // Phase 3 (213): the match-set bells, best-effort — every member of a complete match whose match changed.
    if (match) {
      const toBells = (groups: RoundGroup[]): DrawGroupForBells[] => groups.map(g => { const r = sidesOf(g.members, match.sides, { allowBye: match.bracket }); return { members: g.members.map(m => ({ participant_id: m.participant_id, side: m.side })), complete: r.ok && !r.bye }; });
      const next = await readRoundGroups(admin, rid);
      const participantProfile = new Map(((eligible ?? []) as Array<{ id: string; profile_id?: string }>).filter(r => r.profile_id).map(r => [r.id, r.profile_id as string]));
      await notifyMatchSet(admin, read.event, rid, toBells(previous), toBells(next), participantProfile, actor.profileId);
    }
    const view = await fetchSportEventView(admin, id, actor.profileId, null);
    return NextResponse.json(view, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events/groups] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
