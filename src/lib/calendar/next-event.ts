// Next-commitment-per-child (Wave 5 payoff line) — pure and node-testable,
// beside conflicts.ts. The hub's roster cards answer "what's next for this
// kid" from the SAME merged event set the week strip already fetched (events
// tagged with childIds by the caller, deduped by id) — never a second fetch.

export interface NextEventInput {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  /** Every roster child attached to this event (merged by the caller). */
  childIds: string[];
}

export interface NextEvent {
  eventId: string;
  title: string;
  startMs: number;
  allDay: boolean;
}

/**
 * The soonest not-yet-ENDED event per child. In-progress events count —
 * "Next: today 9:00a" while the meet is running is the truthful answer, and
 * dropping it at the first whistle would blank the line mid-event. Ties
 * break on event id so the same inputs always render the same line.
 */
export function nextEventPerChild(
  events: NextEventInput[] | null | undefined,
  nowMs: number
): Map<string, NextEvent> {
  const best = new Map<string, NextEvent>();
  for (const ev of events ?? []) {
    const startMs = Date.parse(ev.starts_at);
    const endMs = Date.parse(ev.ends_at);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= nowMs) continue;
    for (const childId of ev.childIds) {
      const current = best.get(childId);
      if (
        !current ||
        startMs < current.startMs ||
        (startMs === current.startMs && ev.id < current.eventId)
      ) {
        best.set(childId, {
          eventId: ev.id,
          title: ev.title,
          startMs,
          allDay: ev.all_day,
        });
      }
    }
  }
  return best;
}
