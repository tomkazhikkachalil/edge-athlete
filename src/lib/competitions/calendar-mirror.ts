// ── Contest → calendar mirror (phase 2 R2) — the round-mirror precedent ─────
// Tom's decision: contests LINK events. "Publish to calendar" mints ONE
// normal scoped event (division when the competition is pinned, else the
// org — the audience; the contest keeps competition_id, orthogonal to
// event scope) and stamps contests.event_id. From then on the mirror is
// ONE-WAY and BEST-EFFORT: reschedule updates starts_at/ends_at, cancel
// cancels, delete deletes — a mirror failure must never fail the
// triggering contest write (warn-and-continue, the golf round-mirror
// charter). ZERO events columns are added anywhere in this arc, so the
// seven-field-list silent-drop class stays closed.
//
// The minted event rides every existing rail for free: the read-time org
// merge (STRICT audience — division events reach team/division/org-scoped
// roster members per 146), RSVP materialization, ICS, and the public org
// page's schedule. Deliberately NO bell fan-out v1 — a season schedule
// is dozens of rows; the calendar merge is the surface (recorded as
// deferred polish).

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[CONTEST MIRROR]';

/** Default game length when the org hasn't said otherwise. */
const DEFAULT_GAME_MINUTES = 120;

interface ContestForMirror {
  id: string;
  event_id: string | null;
  scheduled_at: string | null;
  venue_id: string | null;
  facility_id: string | null;
  round: string | null;
}

/** Build the event title from the sides: "Blazers vs Comets — House
 *  League". Leaderboard contests fall back to the competition name. */
export function contestEventTitle(
  competitionName: string,
  sideNames: { home?: string; away?: string }
): string {
  if (sideNames.home && sideNames.away) {
    return `${sideNames.home} vs ${sideNames.away} — ${competitionName}`.slice(0, 120);
  }
  return competitionName.slice(0, 120);
}

/** Mint (or return the existing) mirror event for a contest. Idempotent
 *  via contests.event_id; requires a scheduled time. Returns the event
 *  id, or an error string the route maps to a 400. */
export async function publishContestToCalendar(
  admin: Admin,
  contest: ContestForMirror,
  competition: {
    id: string;
    name: string;
    league_id: string | null;
    club_id: string | null;
    division_id: string | null;
  },
  organizerId: string,
  timezone: string
): Promise<{ eventId: string } | { error: string }> {
  if (contest.event_id) return { eventId: contest.event_id };
  if (!contest.scheduled_at) return { error: 'Schedule the game before publishing it' };

  // Side names for the title (fixture); a leaderboard round publishes as
  // the competition name.
  const { data: participants } = await admin
    .from('contest_participants')
    .select('side, entry:entry_id (team_id)')
    .eq('contest_id', contest.id);
  const sideTeamIds: Record<string, string> = {};
  for (const p of participants ?? []) {
    const entry = Array.isArray(p.entry) ? p.entry[0] : p.entry;
    if (p.side && entry?.team_id) sideTeamIds[p.side] = entry.team_id;
  }
  const teamIds = Object.values(sideTeamIds);
  const { data: teams } = teamIds.length
    ? await admin.from('teams').select('id, name, display_name').in('id', teamIds)
    : { data: [] };
  const nameOf = new Map((teams ?? []).map(t => [t.id, (t.display_name || t.name) as string]));
  const title = contestEventTitle(competition.name, {
    home: sideTeamIds.home ? nameOf.get(sideTeamIds.home) : undefined,
    away: sideTeamIds.away ? nameOf.get(sideTeamIds.away) : undefined,
  });

  // Venue name → the free-text location (the picker's own convention).
  let location: string | null = null;
  if (contest.venue_id) {
    const { data: venue } = await admin
      .from('venues')
      .select('name')
      .eq('id', contest.venue_id)
      .maybeSingle();
    location = venue?.name ?? null;
  }

  const startsAt = new Date(contest.scheduled_at);
  const endsAt = new Date(startsAt.getTime() + DEFAULT_GAME_MINUTES * 60_000);

  const { data: event, error } = await admin
    .from('events')
    .insert({
      organizer_id: organizerId,
      title,
      description: contest.round ? `Round: ${contest.round}` : null,
      location,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      all_day: false,
      timezone,
      category: 'game',
      // The AUDIENCE: division when pinned, else the whole org. The
      // events_one_scope_check allows exactly one of these.
      division_id: competition.division_id,
      league_id: competition.division_id ? null : competition.league_id,
      club_id: competition.division_id ? null : competition.club_id,
      venue_id: contest.venue_id,
      facility_id: contest.facility_id,
    })
    .select('id')
    .single();
  if (error || !event) {
    console.error(`${TAG} event insert failed:`, error);
    return { error: 'Failed to publish to the calendar' };
  }

  const { error: linkError } = await admin
    .from('contests')
    .update({ event_id: event.id })
    .eq('id', contest.id)
    .is('event_id', null);
  if (linkError) {
    // Compensate: an unlinked mirror event is an orphan on every calendar.
    await admin.from('events').delete().eq('id', event.id);
    console.error(`${TAG} link failed:`, linkError);
    return { error: 'Failed to publish to the calendar' };
  }
  return { eventId: event.id };
}

/** One-way sync after a contest write — BEST-EFFORT: never throws, never
 *  fails the caller. Reschedule moves the event; cancel/postpone cancels
 *  it; un-cancel reactivates; delete is handled by mirrorContestDelete. */
export async function mirrorContestChange(
  admin: Admin,
  contest: { event_id: string | null; status: string; scheduled_at: string | null }
): Promise<void> {
  if (!contest.event_id) return;
  try {
    if (contest.status === 'canceled' || contest.status === 'postponed') {
      await admin
        .from('events')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', contest.event_id);
      return;
    }
    const patch: Record<string, unknown> = { status: 'active', cancelled_at: null };
    if (contest.scheduled_at) {
      const startsAt = new Date(contest.scheduled_at);
      patch.starts_at = startsAt.toISOString();
      patch.ends_at = new Date(startsAt.getTime() + DEFAULT_GAME_MINUTES * 60_000).toISOString();
    }
    await admin.from('events').update(patch).eq('id', contest.event_id);
  } catch (e) {
    console.warn(`${TAG} sync failed (continuing):`, e);
  }
}

/** Delete the mirror event when its contest is deleted. Best-effort. */
export async function mirrorContestDelete(admin: Admin, eventId: string | null): Promise<void> {
  if (!eventId) return;
  try {
    await admin.from('events').delete().eq('id', eventId);
  } catch (e) {
    console.warn(`${TAG} event delete failed (continuing):`, e);
  }
}
