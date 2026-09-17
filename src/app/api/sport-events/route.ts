import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { LINK_REFUSAL_COPY, linkRefusal, type CompetitionForLink } from '@/lib/sport-events/contest-link';
import { parseFormatConfig } from '@/lib/sport-events/format-config';
import { mintContestsForEvent, readCompetitionForLink } from '@/lib/sport-events/contest-link-server';
import { resolveSportEventAccess } from '@/lib/sport-events/access';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import { EVENT_COLUMNS, PARTICIPANT_COLUMNS } from '@/lib/sport-events/access-server';
import { readJson, resolveActor } from '@/lib/sport-events/actor-server';
import { snapshotAtAccept } from '@/lib/sport-events/handicap-server';
import { applyTransition } from '@/lib/sport-events/lifecycle-server';
import { mintLinkToken } from '@/lib/sport-events/link-token';
import { snapshotRound, startsOnFor, type RoundSnapshot } from '@/lib/sport-events/rounds-server';
import type { SportEventParticipantRow, SportEventRow, SportEventRoundRow } from '@/lib/sport-events/types';
import { isDateOnly, parseCreateBody, parseListScope } from '@/lib/sport-events/validate';
import { projectEvent } from '@/lib/sport-events/view';
import { fetchSportEventView } from '@/lib/sport-events/view-server';

/**
 * /api/sport-events (Events program, PR 4).
 *
 * POST — create an event: the header row, its rounds (`round: {…}` = one
 * round; `rounds: [{…}]` = a tournament, phase 2 — each a catalog snapshot
 * WITH the stroke index, sequenced in order), the host's participant row (organizer, accepted,
 * playing unless `host_plays: false`), a link token when visibility is
 * `link`; `publish: true` creates it `open` (the wizard's Publish). An org
 * attach needs `manage_competitions` on that org and is never acting-as.
 *
 * GET ?scope=mine|hosting|upcoming|live|past — the signed-in viewer's
 * events (host, or a participant row that is not declined / removed),
 * newest first for past, soonest first otherwise. Phase 1 lists at most
 * 100; a keyset cursor arrives with the tournaments phase.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
    if (limited) return limited;

    const parsed = parseCreateBody(await readJson(request));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const input = parsed.value;

    const actor = await resolveActor(user.id, input.profile_id, 'Not authorized to host for this profile');
    if (!actor.ok) return actor.response;
    const admin = getSupabaseAdmin();

    if (input.club_id || input.league_id) {
      if (actor.actingAs) return NextResponse.json({ error: 'An organization event is hosted from your own account.' }, { status: 403 });
      const side = input.club_id ? 'club' : 'league';
      const gate = await requireOrgManager(admin, user, side, (input.club_id ?? input.league_id) as string, { intent: 'manage_competitions' });
      if (!gate.ok) return gate.response;
    }
    // Phase 2b: "Counts toward" — refused by name BEFORE any insert.
    let competition: CompetitionForLink | null = null;
    if (input.competition_id) {
      competition = await readCompetitionForLink(admin, input.competition_id);
      // Track 2 PR 10: the shape table needs the sport and the shape (a game → a fixture of named sides; without them a game read as a stroke round).
      const refusal = linkRefusal({ club_id: input.club_id, league_id: input.league_id, status: 'draft', format: input.format, sport_key: input.sport_key, shape: input.shape }, competition);
      if (refusal) return NextResponse.json({ error: LINK_REFUSAL_COPY[refusal], reason: refusal }, { status: 400 });
    }
    // Phase 3: the format options at creation (the match shape) — the same strict parser as the PATCH, against THIS body's format and rounds.
    let formatConfig: Record<string, unknown> | null = null;
    if (input.format_config !== undefined) {
      const fc = parseFormatConfig(input.format_config, { roundCount: input.rounds.length, format: input.format, shape: input.shape });
      if (!fc.ok) return NextResponse.json({ error: fc.error }, { status: 400 });
      formatConfig = fc.value as Record<string, unknown>;
    }

    // Every round's catalog snapshot BEFORE any insert: a missing course refuses the whole create.
    const rounds: RoundSnapshot[] = [];
    for (let i = 0; i < input.rounds.length; i++) {
      const snap = await snapshotRound(admin, input.rounds[i]);
      if (!snap) return NextResponse.json({ error: input.rounds.length > 1 ? `rounds[${i}]: course not found` : 'Course not found' }, { status: 400 });
      rounds.push(snap);
    }

    const now = new Date().toISOString();
    const { data: event, error: insertError } = await admin
      .from('sport_events')
      .insert({
        host_profile_id: actor.profileId,
        created_by_user_id: user.id,
        club_id: input.club_id,
        league_id: input.league_id,
        sport_key: input.sport_key,
        name: input.name,
        description: input.description,
        join_mode: input.join_mode,
        visibility: input.visibility,
        link_token: input.visibility === 'link' ? mintLinkToken() : null,
        format: input.format,
        // Phase 4 (215): the shape — golf ⇔ round (the CHECK holds both ways).
        shape: input.shape,
        // Always born a draft: `publish` goes through the open transition
        // below, which mints the announce post (one post per round).
        status: 'draft',
        capacity: input.capacity,
        self_entry: input.self_entry,
        starts_on: startsOnFor(rounds),
        ...(formatConfig !== null ? { format_config: formatConfig } : {}),
      })
      .select(EVENT_COLUMNS)
      .single();
    if (insertError || !event) {
      console.error('[api/sport-events] insert failed:', insertError);
      return NextResponse.json({ error: 'Could not create the event' }, { status: 500 });
    }
    const row = event as SportEventRow;

    const { error: roundError } = await admin.from('sport_event_rounds').insert(rounds.map((r, i) => ({ sport_event_id: row.id, sequence: i + 1, ...r })));
    if (roundError) {
      console.error('[api/sport-events] round insert failed:', roundError);
      await admin.from('sport_events').delete().eq('id', row.id);
      return NextResponse.json({ error: 'Could not create the round' }, { status: 500 });
    }

    const { data: host, error: hostError } = await admin
      .from('sport_event_participants')
      .insert({ sport_event_id: row.id, profile_id: actor.profileId, role: 'organizer', status: 'accepted', playing: input.host_plays, accepted_at: now, responded_at: now })
      .select(PARTICIPANT_COLUMNS)
      .single();
    if (hostError || !host) {
      console.error('[api/sport-events] host row insert failed:', hostError);
      await admin.from('sport_events').delete().eq('id', row.id);
      return NextResponse.json({ error: 'Could not create the event' }, { status: 500 });
    }
    if (input.host_plays) await snapshotAtAccept(admin, host as SportEventParticipantRow);

    // Phase 2b: one contest per round on the chosen competition (best-effort — the
    // organizer can pick it again from the event page; a pre-211 database skips).
    if (competition) {
      const { data: roundRows } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', row.id).order('sequence', { ascending: true });
      const minted = await mintContestsForEvent(admin, row, (roundRows ?? []) as SportEventRoundRow[], competition.id);
      if (!minted.ok) console.error('[api/sport-events] counts-toward mint skipped:', minted.reason);
    }

    if (input.publish) {
      const opened = await applyTransition(admin, { eventId: row.id, to: 'open', actorProfileId: actor.profileId });
      if (!opened.ok) console.error('[api/sport-events] publish on create failed:', opened.reason, opened.error);
    }

    const view = await fetchSportEventView(admin, row.id, actor.profileId, null);
    return NextResponse.json(view, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const url = new URL(request.url);
    const scope = parseListScope(url.searchParams.get('scope'));
    const actor = await resolveActor(user.id, url.searchParams.get('as'));
    if (!actor.ok) return actor.response;
    const todayParam = url.searchParams.get('today');
    const today = isDateOnly(todayParam) ? todayParam : new Date().toISOString().slice(0, 10);
    const admin = getSupabaseAdmin();

    const { data: mine, error: rowsError } = await admin
      .from('sport_event_participants')
      .select(PARTICIPANT_COLUMNS)
      .eq('profile_id', actor.profileId)
      .not('status', 'in', '(declined,removed)');
    if (rowsError) {
      console.error('[api/sport-events] roster read failed:', rowsError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
    const rowByEvent = new Map<string, SportEventParticipantRow>();
    for (const r of (mine ?? []) as SportEventParticipantRow[]) rowByEvent.set(r.sport_event_id, r);

    const { data: hosted } = await admin.from('sport_events').select('id').eq('host_profile_id', actor.profileId);
    const ids = new Set<string>([...rowByEvent.keys(), ...((hosted ?? []) as Array<{ id: string }>).map(h => h.id)]);
    if (ids.size === 0) return NextResponse.json({ events: [], scope }, { headers: { 'Cache-Control': 'private, no-store' } });

    const { data: events, error: eventsError } = await admin.from('sport_events').select(EVENT_COLUMNS).in('id', [...ids]);
    if (eventsError) {
      console.error('[api/sport-events] list read failed:', eventsError);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }

    // Phase 2: each listed event's rounds at a glance — one grouped read.
    const { data: roundRows } = await admin.from('sport_event_rounds').select('sport_event_id, sequence, status').in('sport_event_id', [...ids]).neq('status', 'cancelled');
    const roundsByEvent = new Map<string, { count: number; completed: number; live_sequence: number | null }>();
    for (const r of (roundRows ?? []) as Array<{ sport_event_id: string; sequence: number; status: string }>) {
      const cur = roundsByEvent.get(r.sport_event_id) ?? { count: 0, completed: 0, live_sequence: null };
      cur.count += 1;
      if (r.status === 'completed') cur.completed += 1;
      if (r.status === 'live') cur.live_sequence = r.sequence;
      roundsByEvent.set(r.sport_event_id, cur);
    }

    const out = [];
    for (const e of (events ?? []) as SportEventRow[]) {
      const own = rowByEvent.get(e.id) ?? null;
      const access = resolveSportEventAccess({
        event: { hostProfileId: e.host_profile_id, visibility: e.visibility, status: e.status, linkToken: e.link_token },
        viewerId: actor.profileId,
        presentedToken: null,
        participant: own ? { role: own.role, status: own.status } : null,
      });
      if (!access) continue;
      const isHosting = access.canManage;
      const isPast = e.status === 'completed' || e.status === 'cancelled' || (e.status !== 'live' && e.starts_on !== null && e.starts_on < today);
      const keep =
        scope === 'mine' ? true
        : scope === 'hosting' ? isHosting
        : scope === 'live' ? e.status === 'live'
        : scope === 'past' ? isPast
        : /* upcoming */ !isPast && e.status !== 'live';
      if (!keep) continue;
      out.push({ ...projectEvent(e, access), my_role: access.role, my_status: access.participantStatus, can_manage: access.canManage, rounds: roundsByEvent.get(e.id) ?? { count: 1, completed: 0, live_sequence: null } });
    }
    const dir = scope === 'past' || scope === 'mine' ? -1 : 1;
    out.sort((a, b) => {
      const ka = a.starts_on ?? '';
      const kb = b.starts_on ?? '';
      if (ka !== kb) return ka < kb ? -dir : dir;
      return a.id < b.id ? -1 : 1;
    });
    return NextResponse.json({ events: out.slice(0, 100), scope }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[api/sport-events] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
