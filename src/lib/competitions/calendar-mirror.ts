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
//
// Phase 6e S4: a golf league round has NO instant — it has a PLAY WINDOW
// (play_from..play_to, DATEs). Such a round publishes as an ALL-DAY,
// MULTI-DAY event: local-midnight bounds in the publisher's zone, end
// EXCLUSIVE (the 057 storage convention `buildVEvent`/the grid already
// honour), title "{round} — {competition}", description "Play any day
// Sep 15 – 21 · 9 holes at {course}". A window move re-derives the
// bounds from the event's own stored zone.

import type { SupabaseClient } from '@supabase/supabase-js';
import { zonedWallClockToUtc } from '@/lib/calendar/recurrence';
import { addDaysIso, formatDateRange } from './golf-weeks';

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
  /** S4: the golf league round's play window (DATEs) + hole count. */
  play_from?: string | null;
  play_to?: string | null;
  holes?: number | null;
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

/** S4: "Week 3 — Thursday Nine" for a play-window round. */
export function contestWindowTitle(competitionName: string, round: string | null): string {
  return `${round?.trim() || 'Round'} — ${competitionName}`.slice(0, 120);
}

/** S4: "Play any day Sep 15 – 21 · 9 holes at QA Nine". */
export function contestWindowDescription(
  playFrom: string,
  playTo: string,
  holes: number | null | undefined,
  courseName: string | null
): string {
  return [
    `Play any day ${formatDateRange(playFrom, playTo)}`,
    holes ? `${holes} holes${courseName ? ` at ${courseName}` : ''}` : courseName ? `at ${courseName}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** S4: the all-day bounds of a play window in `timeZone` — local
 *  midnight of play_from to local midnight of the day AFTER play_to
 *  (end exclusive). A one-day window is still a full day. Pure. */
export function windowEventBounds(
  playFrom: string,
  playTo: string,
  timeZone: string
): { startsAt: string; endsAt: string } {
  const [fy, fm, fd] = playFrom.split('-').map(Number);
  const next = addDaysIso(playTo, 1);
  const [ty, tm, td] = next.split('-').map(Number);
  const startMs = zonedWallClockToUtc(fy, fm, fd, 0, 0, timeZone);
  const endMs = zonedWallClockToUtc(ty, tm, td, 0, 0, timeZone);
  return { startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString() };
}

const hasWindow = (c: Pick<ContestForMirror, 'play_from' | 'play_to'>): c is { play_from: string; play_to: string } =>
  !!c.play_from && !!c.play_to;

/** Mint (or return the existing) mirror event for a contest. Idempotent
 *  via contests.event_id; requires a scheduled time OR (S4) a play
 *  window. Returns the event id, or an error string the route maps to
 *  a 400. */
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
  const windowed = !contest.scheduled_at && hasWindow(contest);
  if (!contest.scheduled_at && !windowed) return { error: 'Schedule the game before publishing it' };

  // Side names for the title (fixture); a leaderboard round publishes as
  // the competition name; a play-window round as "{round} — {competition}".
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
  const title = windowed
    ? contestWindowTitle(competition.name, contest.round)
    : contestEventTitle(competition.name, {
        home: sideTeamIds.home ? nameOf.get(sideTeamIds.home) : undefined,
        away: sideTeamIds.away ? nameOf.get(sideTeamIds.away) : undefined,
      });

  // Venue name → the free-text location (the picker's own convention);
  // for a golf round the linked catalog course names the description.
  let location: string | null = null;
  let courseName: string | null = null;
  if (contest.venue_id) {
    const { data: venue } = await admin
      .from('venues')
      .select('name, golf_course_id')
      .eq('id', contest.venue_id)
      .maybeSingle();
    location = venue?.name ?? null;
    courseName = location;
    if (windowed && venue?.golf_course_id) {
      const { data: course } = await admin
        .from('golf_courses')
        .select('name')
        .eq('id', venue.golf_course_id)
        .maybeSingle();
      if (course?.name) courseName = course.name as string;
    }
  }

  let startsAt: string;
  let endsAt: string;
  let description: string | null;
  if (windowed) {
    const bounds = windowEventBounds(contest.play_from as string, contest.play_to as string, timezone);
    startsAt = bounds.startsAt;
    endsAt = bounds.endsAt;
    description = contestWindowDescription(contest.play_from as string, contest.play_to as string, contest.holes, courseName);
  } else {
    const start = new Date(contest.scheduled_at as string);
    startsAt = start.toISOString();
    endsAt = new Date(start.getTime() + DEFAULT_GAME_MINUTES * 60_000).toISOString();
    description = contest.round ? `Round: ${contest.round}` : null;
  }

  const { data: event, error } = await admin
    .from('events')
    .insert({
      organizer_id: organizerId,
      title,
      description,
      location,
      starts_at: startsAt,
      ends_at: endsAt,
      all_day: windowed,
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
 *  fails the caller. Reschedule moves the event; a window move (S4)
 *  re-derives the all-day bounds in the event's own zone; cancel/postpone
 *  cancels; un-cancel reactivates; delete is handled by
 *  mirrorContestDelete. */
export async function mirrorContestChange(
  admin: Admin,
  contest: {
    event_id: string | null;
    status: string;
    scheduled_at: string | null;
    play_from?: string | null;
    play_to?: string | null;
  }
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
      patch.all_day = false;
    } else if (hasWindow(contest)) {
      const { data: ev } = await admin
        .from('events')
        .select('timezone')
        .eq('id', contest.event_id)
        .maybeSingle();
      const bounds = windowEventBounds(contest.play_from, contest.play_to, (ev?.timezone as string | undefined) || 'UTC');
      patch.starts_at = bounds.startsAt;
      patch.ends_at = bounds.endsAt;
      patch.all_day = true;
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
