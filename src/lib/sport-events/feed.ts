/**
 * The event beside a post in the feed (Events program, PR 15) — pure
 * projection. ONE post per round, three states: announced (no scores),
 * live (the round exists), results (scores). The feed carries enough of
 * the event for the chip and the announce card; nothing private leaves.
 * Phase 2: the ROUND's sequence, status and the event's round count ride
 * along, so a round-2 card reads "Round 2 of 3" and is announced while
 * round 1 is live — the state is the round's, never the event's.
 */
export const SPORT_EVENT_ROUND_LABEL_SELECT =
  'id, sequence, status, scheduled_on, course_name, holes, starting_hole, event:sport_event_id (id, name, status, join_mode, visibility, host_profile_id)';

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
  /** Phase 2: the round's place and state; `round_count` = the event's non-cancelled rounds (1 when unknown). */
  sequence: number;
  round_status: string;
  round_count: number;
}

interface RoundLabelRow {
  id: string;
  sequence?: number;
  status?: string;
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
    out.set(raw.id, { id: ev.id, name: ev.name, status: ev.status, join_mode: ev.join_mode, visibility: ev.visibility, host_profile_id: ev.host_profile_id, round_id: raw.id, scheduled_on: raw.scheduled_on, course_name: raw.course_name, holes: raw.holes, starting_hole: raw.starting_hole, sequence: raw.sequence ?? 1, round_status: raw.status ?? 'scheduled', round_count: 1 });
  }
  return out;
}

/** The event ids a label map names — the grouped round-count query's input. */
export function sportEventIdsOf(labels: Map<string, PostSportEvent>): string[] {
  return [...new Set([...labels.values()].map(e => e.id))];
}

/** Stamp `round_count` from the rounds rows (`sport_event_id` per non-cancelled round) — one grouped read per feed page. */
export function applyRoundCounts(labels: Map<string, PostSportEvent>, rows: ReadonlyArray<{ sport_event_id: string }>): void {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.sport_event_id, (counts.get(r.sport_event_id) ?? 0) + 1);
  for (const e of labels.values()) e.round_count = Math.max(1, counts.get(e.id) ?? 1);
}

/**
 * Which state the post is in — the card leads with it. Phase 2: the ROUND's
 * status decides (a round-2 post is announced while round 1 is live); a
 * cancelled event or round is cancelled; results once the round completed.
 */
export function postEventState(event: Pick<PostSportEvent, 'status'> & { round_status?: string }, hasScores: boolean): 'announced' | 'live' | 'results' | 'cancelled' {
  if (event.status === 'cancelled' || event.round_status === 'cancelled') return 'cancelled';
  const status = event.round_status ?? event.status;
  if (hasScores && status === 'completed') return 'results';
  if (status === 'live') return 'live';
  if (status === 'completed') return 'results';
  return 'announced';
}

/** "Round 2 of 3" on a tournament, nothing on a single round. */
export function roundLabelOf(event: Pick<PostSportEvent, 'sequence' | 'round_count'>): string | null {
  return event.round_count > 1 ? `Round ${event.sequence} of ${event.round_count}` : null;
}
