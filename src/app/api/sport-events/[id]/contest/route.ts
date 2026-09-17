import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { readSportEventAccess } from '@/lib/sport-events/access-server';
import { readJson } from '@/lib/sport-events/actor-server';
import { eventOrg, eventShape, LINK_REFUSAL_COPY, linkRefusal } from '@/lib/sport-events/contest-link';
import { readFormatConfig, readMatchConfig } from '@/lib/sport-events/format-config';
import { linkMatchEventToBracket, mintContestsForEvent, readCompetitionForLink, unlinkContestsForEvent } from '@/lib/sport-events/contest-link-server';
import { ROUND_COLUMNS } from '@/lib/sport-events/rounds-server';
import type { SportEventRoundRow } from '@/lib/sport-events/types';

const NOT_FOUND = () => NextResponse.json({ error: 'Event not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

/**
 * PUT /api/sport-events/[id]/contest — "Counts toward" (Events program,
 * phase 2b, B1). Body `{ competition_id: string | null }`. The event's
 * organizer who ALSO holds `manage_competitions` on the event's org (the
 * same authority the create route asks for an org-hosted event) picks one
 * of the org's golf leaderboard competitions: one contest per
 * non-cancelled round is minted (idempotent) with the accepted playing
 * players entered; `null` removes the link while no result exists. Draft
 * or open only — the competition cannot change once play began. Every
 * refusal is named (`reason`).
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  const limited = await enforceRateLimit(request, 'sport-event');
  if (limited) return limited;
  try {
    const { user } = await getServerAuth(request);
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    const admin = getSupabaseAdmin();
    const read = await readSportEventAccess(admin, id, user.id, null);
    if (!read) return NOT_FOUND();
    if (!read.access.canManage) return NextResponse.json({ error: 'Only an organizer can change what the event counts toward' }, { status: 403 });
    const org = eventOrg(read.event);
    if (!org) return NextResponse.json({ error: LINK_REFUSAL_COPY.no_org, reason: 'no_org' }, { status: 400 });
    const gate = await requireOrgManager(admin, user, org.side, org.id, { intent: 'manage_competitions' });
    if (!gate.ok) return gate.response;

    const body = (await readJson(request)) as { competition_id?: unknown } | null;
    const raw = body?.competition_id;
    if (raw !== null && (typeof raw !== 'string' || !UUID_RE.test(raw))) {
      return NextResponse.json({ error: 'competition_id must be a competition id or null' }, { status: 400 });
    }
    const { data: roundRows } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', id).order('sequence', { ascending: true });
    const rounds = (roundRows ?? []) as SportEventRoundRow[];

    if (raw === null) {
      if (read.event.status !== 'draft' && read.event.status !== 'open') return NextResponse.json({ error: LINK_REFUSAL_COPY.event_over, reason: 'event_over' }, { status: 409 });
      const un = await unlinkContestsForEvent(admin, read.event, rounds.map(r => r.id));
      if (!un.ok) {
        if (un.reason === 'needs_migration') return NextResponse.json({ error: 'Counting toward a competition is not available yet (run migration 211)', reason: 'needs_migration' }, { status: 503 });
        return NextResponse.json({ error: LINK_REFUSAL_COPY.results_exist, reason: 'results_exist' }, { status: 409 });
      }
      return NextResponse.json({ counts_toward: null, removed: un.removed });
    }

    const competition = await readCompetitionForLink(admin, raw);
    const matchConfig = readMatchConfig(readFormatConfig(read.event.format_config, Math.max(rounds.length, 1), read.event.format), read.event.format);
    const refusal = linkRefusal({ ...read.event, bracket: matchConfig?.bracket ?? false }, competition);
    if (refusal) return NextResponse.json({ error: LINK_REFUSAL_COPY[refusal], reason: refusal }, { status: refusal === 'event_over' ? 409 : 400 });
    // Leftovers PR 7: a bracketed MATCH event keeps the intent on the event — nothing minted; each round's matches are stamped onto the bracket's slots at go-live.
    if (eventShape(read.event) === 'match') {
      const linked = await linkMatchEventToBracket(admin, read.event, rounds, raw);
      if (!linked.ok) {
        if (linked.reason === 'needs_migration') return NextResponse.json({ error: 'Counting a match event toward a bracket is not available yet (run migration 221)', reason: 'needs_migration' }, { status: 503 });
        return NextResponse.json({ error: LINK_REFUSAL_COPY[linked.reason], reason: linked.reason }, { status: 409 });
      }
      return NextResponse.json({ counts_toward: { competition_id: competition!.id, competition_name: competition!.name, contests: [] }, stages: linked.stages });
    }
    const minted = await mintContestsForEvent(admin, read.event, rounds, raw);
    if (!minted.ok) {
      if (minted.reason === 'needs_migration') return NextResponse.json({ error: 'Counting toward a competition is not available yet (run migration 211)', reason: 'needs_migration' }, { status: 503 });
      return NextResponse.json({ error: 'Could not link the competition' }, { status: 500 });
    }
    return NextResponse.json({
      counts_toward: {
        competition_id: competition!.id,
        competition_name: competition!.name,
        contests: [...minted.contests.entries()].map(([round_id, contest_id]) => ({ round_id, contest_id })),
      },
    });
  } catch (error) {
    console.error('[api/sport-events/[id]/contest] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
