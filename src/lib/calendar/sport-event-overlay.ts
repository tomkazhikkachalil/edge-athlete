/**
 * Sport events on the calendar — the pure half (Events program, phase 2b,
 * B2). A sibling of `activity-overlay.ts`: an event's UPCOMING and LIVE
 * rounds appear on the viewer's calendar as READ-TIME items (never
 * `events` rows — a participant's status churns through invite / accept /
 * waitlist / withdraw, and a mirrored row would be a second state machine
 * kept in step from `join-server.ts`; a completed round is NOT here — the
 * mirrored golf round in the activity overlay is its record). Items
 * impersonate `EventListItem` like the activity ones; the `kind`
 * discriminant `'sport_event'` is what routes a tap to the event's page
 * instead of the event detail modal (a guaranteed 404).
 *
 * Dates: `scheduled_on` is a DATE — all-day with UTC-midnight exclusive-end
 * bounds (the 057 convention; NEVER `new Date('YYYY-MM-DD')`); with the
 * viewer's group `tee_time` (a timestamptz instant) the item is TIMED —
 * four and a half hours for 18 holes, two and a quarter for nine.
 */
import type { SportEventParticipantStatus, SportEventRole } from '@/lib/sport-events/types';

export interface SportEventItemPayload {
  event_id: string;
  round_id: string;
  sequence: number;
  round_count: number;
  round_status: 'scheduled' | 'live';
  /** The tab the tap opens: the leaderboard while live, the schedule otherwise. */
  tab: 'schedule' | 'leaderboard';
}

export interface SportEventItem {
  id: string;
  organizer_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  category: 'tournament';
  status: 'active';
  cancelled_at: null;
  series_id: null;
  series_override: false;
  /** A pending invite keeps the dashed needs-reply styling; everything else is solid. */
  my_status: 'invited' | 'accepted';
  is_organizer: boolean;
  kind: 'sport_event';
  sport_event: SportEventItemPayload;
}

export interface SportEventItemInput {
  viewerId: string;
  event: { id: string; name: string };
  /** `starts_at` / `timezone` (leftovers PR 8, 221): a round's own start — a timed item in the ROUND's zone when the viewer has no tee time. */
  round: { id: string; sequence: number; scheduled_on: string; status: 'scheduled' | 'live'; holes: number; course_name: string; name?: string | null; starts_at?: string | null; timezone?: string | null };
  /** Non-cancelled rounds on the event. */
  roundCount: number;
  /** The viewer's group tee time (an ISO instant) when they are grouped on this round. */
  teeTime: string | null;
  role: SportEventRole | null;
  participantStatus: SportEventParticipantStatus;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const HOURS = 3_600_000;

/** How long a round blocks on a timed item: 4h30 for 18, 2h15 for nine. */
export function roundDurationMs(holes: number): number {
  return holes >= 18 ? 4.5 * HOURS : 2.25 * HOURS;
}

/** "Round 2 of 3" on a tournament; nothing on a single round. */
export function roundSuffix(sequence: number, roundCount: number): string {
  return roundCount > 1 ? ` · Round ${sequence} of ${roundCount}` : '';
}

/** Null when the date is not a clean YYYY-MM-DD (never render at epoch). */
export function sportEventRoundToItem(input: SportEventItemInput): SportEventItem | null {
  const { viewerId, event, round, roundCount, teeTime, role, participantStatus } = input;
  if (!YMD_RE.test(round.scheduled_on)) return null;
  const teeMs = teeTime ? Date.parse(teeTime) : NaN;
  const roundStartMs = round.starts_at ? Date.parse(round.starts_at) : NaN;
  let starts_at: string;
  let ends_at: string;
  let all_day: boolean;
  let timezone = 'UTC';
  if (Number.isFinite(teeMs)) {
    starts_at = new Date(teeMs).toISOString();
    ends_at = new Date(teeMs + roundDurationMs(round.holes)).toISOString();
    all_day = false;
  } else if (Number.isFinite(roundStartMs)) {
    starts_at = new Date(roundStartMs).toISOString();
    ends_at = new Date(roundStartMs + roundDurationMs(round.holes)).toISOString();
    all_day = false;
    timezone = round.timezone || 'UTC';
  } else {
    const [y, m, d] = round.scheduled_on.split('-').map(Number);
    const startMs = Date.UTC(y, m - 1, d);
    starts_at = new Date(startMs).toISOString();
    ends_at = new Date(startMs + 86_400_000).toISOString();
    all_day = true;
  }
  const tab = round.status === 'live' ? 'leaderboard' : 'schedule';
  return {
    id: `sport_event:${round.id}`,
    organizer_id: viewerId,
    title: `${event.name}${roundSuffix(round.sequence, roundCount)}`,
    description: round.name ?? null,
    location: round.course_name,
    starts_at,
    ends_at,
    all_day,
    timezone,
    category: 'tournament',
    status: 'active',
    cancelled_at: null,
    series_id: null,
    series_override: false,
    my_status: participantStatus === 'invited' ? 'invited' : 'accepted',
    is_organizer: role === 'organizer' || role === 'co_organizer',
    kind: 'sport_event',
    sport_event: { event_id: event.id, round_id: round.id, sequence: round.sequence, round_count: roundCount, round_status: round.status, tab },
  };
}

/** Where a tap goes: the event's page on the round, the leaderboard while live. */
export function sportEventHref(payload: SportEventItemPayload): string {
  return `/events/${payload.event_id}?tab=${payload.tab}&round=${encodeURIComponent(payload.round_id)}`;
}
