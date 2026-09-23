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
//
// Leftovers PR 4: a MEET SESSION publishes as ONE event shared by every
// contest of the session (`contests.event_id` is a plain FK — many rows,
// one event). THE SHARED-EVENT RULE: an event referenced by more than one
// contest is a session's — `mirrorContestChange` applies only
// `sharedMirrorAction` (cancel when every contest is out, reactivate
// otherwise) and never rewrites its clock (the session publish is the one
// door for that); `mirrorContestDelete` deletes it only when no other
// contest still references it.

import type { SupabaseClient } from '@supabase/supabase-js';
import { zonedWallClockToUtc } from '@/lib/calendar/recurrence';
import { addDaysIso, formatDateRange } from './golf-weeks';
import { type OrgKindEmbed } from '@/lib/orgs/org-ref';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[CONTEST MIRROR]';

/** Default game length when the org hasn't said otherwise. */
const DEFAULT_GAME_MINUTES = 120;
/** Leftovers PR 4: a meet session's default length. */
export const DEFAULT_SESSION_MINUTES = 180;

export const sessionEventTitle = (competitionName: string, session: number): string => `${competitionName} — Session ${session}`.slice(0, 120);

/** The session's bounds: the given end, else the default length after the start. */
export function sessionBounds(startsAt: string, endsAt?: string | null): { startsAt: string; endsAt: string } {
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : new Date(start.getTime() + DEFAULT_SESSION_MINUTES * 60_000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}

/** "Session 1 · 100m, 200m, 4×100m relay". */
export function sessionDescription(session: number, eventLabels: ReadonlyArray<string>): string {
  return [`Session ${session}`, eventLabels.length > 0 ? eventLabels.join(', ') : null].filter(Boolean).join(' · ').slice(0, 2000);
}

/** A shared event follows its contests only in life or death: cancelled when EVERY contest is canceled / postponed, active otherwise — never a time change. */
export function sharedMirrorAction(siblings: ReadonlyArray<{ status: string }>): 'cancel' | 'reactivate' {
  return siblings.length > 0 && siblings.every(s => s.status === 'canceled' || s.status === 'postponed') ? 'cancel' : 'reactivate';
}

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
    org_id: string | null;
    org?: OrgKindEmbed;
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
    .select('side, entry:entry_id (team_id, name)')
    .eq('contest_id', contest.id);
  const sideTeamIds: Record<string, string> = {};
  // Track 2 PR 6 (219): an ad-hoc side's own name.
  const sideAdHoc: { home?: string; away?: string } = {};
  for (const p of participants ?? []) {
    const entry = Array.isArray(p.entry) ? p.entry[0] : p.entry;
    if (p.side && entry?.team_id) sideTeamIds[p.side] = entry.team_id;
    else if (p.side && (entry as { name?: string | null } | null)?.name) sideAdHoc[p.side as 'home' | 'away'] = (entry as { name?: string | null }).name as string;
  }
  const teamIds = Object.values(sideTeamIds);
  const { data: teams } = teamIds.length
    ? await admin.from('teams').select('id, name, display_name').in('id', teamIds)
    : { data: [] };
  const nameOf = new Map((teams ?? []).map(t => [t.id, (t.display_name || t.name) as string]));
  const title = windowed
    ? contestWindowTitle(competition.name, contest.round)
    : contestEventTitle(competition.name, {
        home: sideTeamIds.home ? nameOf.get(sideTeamIds.home) : sideAdHoc.home,
        away: sideTeamIds.away ? nameOf.get(sideTeamIds.away) : sideAdHoc.away,
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
      org_id: competition.division_id ? null : competition.org_id,
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

export interface SessionPublishInput {
  competition: { id: string; name: string; org_id: string | null; org?: OrgKindEmbed; division_id: string | null };
  session: number;
  contests: Array<{ id: string; event_id: string | null }>;
  eventLabels: string[];
  startsAt: string;
  endsAt?: string | null;
  timezone: string;
  venueId?: string | null;
}

/** Mint (or move) the ONE calendar event of a meet session and stamp it on every contest of the session (their `scheduled_at` = the
 *  start, their venue the session's). Idempotent: the session's contests already sharing an event → that event's clock moves; a session
 *  whose contests were published on their own (several event ids) → `session_split`. */
export async function publishSessionToCalendar(admin: Admin, input: SessionPublishInput, organizerId: string): Promise<{ eventId: string; created: boolean } | { error: string; reason: string }> {
  const eventIds = [...new Set(input.contests.map(c => c.event_id).filter((id): id is string => !!id))];
  if (eventIds.length > 1) return { error: 'Some of this session’s events were published on their own — remove those calendar entries first.', reason: 'session_split' };
  const bounds = sessionBounds(input.startsAt, input.endsAt);
  let location: string | null = null;
  if (input.venueId) {
    const { data: venue } = await admin.from('venues').select('name').eq('id', input.venueId).maybeSingle();
    location = (venue?.name as string | undefined) ?? null;
  }
  const description = sessionDescription(input.session, input.eventLabels);
  const stamp = async (eventId: string) => {
    const { error } = await admin
      .from('contests')
      .update({ event_id: eventId, scheduled_at: bounds.startsAt, ...(input.venueId !== undefined ? { venue_id: input.venueId } : {}) })
      .in('id', input.contests.map(c => c.id));
    return error ?? null;
  };
  if (eventIds.length === 1) {
    const { error } = await admin
      .from('events')
      .update({ starts_at: bounds.startsAt, ends_at: bounds.endsAt, timezone: input.timezone, description, status: 'active', cancelled_at: null, ...(input.venueId !== undefined ? { venue_id: input.venueId, location } : {}) })
      .eq('id', eventIds[0]);
    if (error) { console.error(`${TAG} session event move failed:`, error); return { error: 'Failed to move the session', reason: 'move' }; }
    const stampError = await stamp(eventIds[0]);
    if (stampError) console.warn(`${TAG} session stamp failed (continuing):`, stampError.message);
    return { eventId: eventIds[0], created: false };
  }
  const { data: event, error } = await admin
    .from('events')
    .insert({
      organizer_id: organizerId,
      title: sessionEventTitle(input.competition.name, input.session),
      description,
      location,
      starts_at: bounds.startsAt,
      ends_at: bounds.endsAt,
      all_day: false,
      timezone: input.timezone,
      category: 'game',
      division_id: input.competition.division_id,
      org_id: input.competition.division_id ? null : input.competition.org_id,
      venue_id: input.venueId ?? null,
      facility_id: null,
    })
    .select('id')
    .single();
  if (error || !event) { console.error(`${TAG} session event insert failed:`, error); return { error: 'Failed to publish the session', reason: 'insert' }; }
  const stampError = await stamp(event.id as string);
  if (stampError) {
    await admin.from('events').delete().eq('id', event.id);
    console.error(`${TAG} session link failed:`, stampError);
    return { error: 'Failed to publish the session', reason: 'link' };
  }
  return { eventId: event.id as string, created: true };
}

/** How many contests reference an event (a session's event is shared). */
async function contestsOnEvent(admin: Admin, eventId: string): Promise<Array<{ status: string }>> {
  // No `.limit()` here: the mirror's unit fake chains select → eq only; a session holds at most a few dozen contests.
  const { data } = await admin.from('contests').select('status').eq('event_id', eventId);
  return (Array.isArray(data) ? data : []) as Array<{ status: string }>;
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
    // The shared-event rule: a session's event (referenced by several contests) follows only life or death, never one contest's clock.
    const siblings = await contestsOnEvent(admin, contest.event_id);
    if (siblings.length > 1) {
      const action = sharedMirrorAction(siblings);
      await admin.from('events').update(action === 'cancel' ? { status: 'cancelled', cancelled_at: new Date().toISOString() } : { status: 'active', cancelled_at: null }).eq('id', contest.event_id);
      return;
    }
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
    // A session's event outlives one of its contests (the callers delete the mirror BEFORE the row — one reference is the row itself).
    if ((await contestsOnEvent(admin, eventId)).length > 1) return;
    await admin.from('events').delete().eq('id', eventId);
  } catch (e) {
    console.warn(`${TAG} event delete failed (continuing):`, e);
  }
}
