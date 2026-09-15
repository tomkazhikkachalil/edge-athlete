/**
 * The event beside a post in the feed (Events program, PR 15) — pure
 * projection. ONE post per round, three states: announced (no scores),
 * live (the round exists), results (scores). The feed carries enough of
 * the event for the chip and the announce card; nothing private leaves.
 */
export const SPORT_EVENT_ROUND_LABEL_SELECT =
  'id, scheduled_on, course_name, holes, starting_hole, event:sport_event_id (id, name, status, join_mode, visibility, host_profile_id)';

export interface PostSportEvent {
  id: string;
  name: string;
  status: string;
  join_mode: string;
  visibility: string;
  host_profile_id: string;
  round_id: string;
  scheduled_on: string;
  course_name: string;
  holes: number;
  starting_hole: number;
}

interface RoundLabelRow {
  id: string;
  scheduled_on: string;
  course_name: string;
  holes: number;
  starting_hole: number;
  event: { id: string; name: string; status: string; join_mode: string; visibility: string; host_profile_id: string } | Array<{ id: string; name: string; status: string; join_mode: string; visibility: string; host_profile_id: string }> | null;
}

export function sportEventLabelsByRound(rows: unknown[]): Map<string, PostSportEvent> {
  const out = new Map<string, PostSportEvent>();
  for (const raw of rows as RoundLabelRow[]) {
    const ev = Array.isArray(raw.event) ? raw.event[0] : raw.event;
    if (!raw?.id || !ev) continue;
    out.set(raw.id, { id: ev.id, name: ev.name, status: ev.status, join_mode: ev.join_mode, visibility: ev.visibility, host_profile_id: ev.host_profile_id, round_id: raw.id, scheduled_on: raw.scheduled_on, course_name: raw.course_name, holes: raw.holes, starting_hole: raw.starting_hole });
  }
  return out;
}

/** Which state the post is in — the card leads with it. */
export function postEventState(event: Pick<PostSportEvent, 'status'>, hasScores: boolean): 'announced' | 'live' | 'results' | 'cancelled' {
  if (event.status === 'cancelled') return 'cancelled';
  if (hasScores && event.status === 'completed') return 'results';
  if (event.status === 'live') return 'live';
  if (event.status === 'completed') return 'results';
  return 'announced';
}
