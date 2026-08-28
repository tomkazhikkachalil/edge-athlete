/**
 * Guessing which calendar event a photo belongs to, from when it was taken
 * (Wave 5 — the guardian batch upload's auto-attach offer).
 *
 * IT IS ALWAYS A SUGGESTION, NEVER A SILENT ATTACHMENT. The same two reasons
 * as the golf segment matcher (segment-autotag.ts), and they are why the
 * Attach/No-thanks chip is mandatory rather than a nice-to-have:
 *
 *  1. `File.lastModified` is not reliably capture time. Some Android pickers
 *     report the moment the file was COPIED, and anything that has been
 *     through an edit or a share sheet can carry a fresh timestamp.
 *  2. Calendars overlap. A photo taken during an all-day tournament that
 *     also contains a timed practice must not be confidently attributed to
 *     either — ambiguity is a refusal, not a coin flip.
 *
 * Pure, so all of that is testable; there is no jsdom in this repo.
 */

export interface EventWindow {
  eventId: string;
  /** ms epoch bounds of the event itself. */
  startMs: number;
  endMs: number;
  title: string;
  /** All-day events match by containment ONLY — no gap padding: "near an
   *  all-day thing" is meaningless. */
  allDay?: boolean;
}

export interface InferEventOptions {
  /** How far outside a timed event a capture may sit and still belong to it.
   *  Default 90 minutes: warm-up before, pack-up and podium after. */
  maxGapMs?: number;
}

export interface InferEventResult {
  /** The suggested event, or null when we should not guess. */
  eventId: string | null;
  title: string | null;
  /** `low` means "show nothing pre-selected". */
  confidence: 'high' | 'low';
  reason?: 'no-data' | 'outside-window' | 'ambiguous';
}

const DEFAULT_MAX_GAP_MS = 90 * 60 * 1000;

const NO_MATCH = (reason: InferEventResult['reason']): InferEventResult => ({
  eventId: null,
  title: null,
  confidence: 'low',
  reason,
});

/** Is the capture inside this event's match window? */
function contains(event: EventWindow, capturedAtMs: number, maxGapMs: number): boolean {
  const pad = event.allDay ? 0 : maxGapMs;
  return capturedAtMs >= event.startMs - pad && capturedAtMs <= event.endMs + pad;
}

/** Deterministic order: earlier start first, then eventId lexicographic —
 *  never input order (the same photo must get the same answer whatever order
 *  rows came back in). */
function preferred(a: EventWindow, b: EventWindow): EventWindow {
  if (a.startMs !== b.startMs) return a.startMs < b.startMs ? a : b;
  return a.eventId < b.eventId ? a : b;
}

/**
 * Suggest an event for a capture time. Containment (padded for timed events)
 * wins; TWO containments = refusal — an overlapping all-day event must not
 * silently steal a photo from the game inside it, nor vice versa.
 */
export function inferEvent(
  capturedAtMs: number | null | undefined,
  events: EventWindow[] | null | undefined,
  options: InferEventOptions = {}
): InferEventResult {
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;

  if (
    typeof capturedAtMs !== 'number' ||
    !Number.isFinite(capturedAtMs) ||
    !events?.length
  ) {
    return NO_MATCH('no-data');
  }
  const usable = events.filter(
    e => Number.isFinite(e.startMs) && Number.isFinite(e.endMs) && e.endMs >= e.startMs
  );
  if (usable.length === 0) return NO_MATCH('no-data');

  const containing = usable.filter(e => contains(e, capturedAtMs, maxGapMs));
  if (containing.length === 0) return NO_MATCH('outside-window');
  if (containing.length > 1) {
    // Exception: identical duplicates (same event fetched via two children)
    // are one commitment, not ambiguity.
    const distinct = new Set(containing.map(e => e.eventId));
    if (distinct.size > 1) return NO_MATCH('ambiguous');
  }

  const match = containing.reduce(preferred);
  return { eventId: match.eventId, title: match.title, confidence: 'high' };
}

/** Build EventWindows from the calendar API's event shape (already filtered
 *  of overlay/cancelled rows by the caller). */
export function eventWindowsFromApi(
  events: Array<{ id: string; title: string; starts_at: string; ends_at: string; all_day?: boolean }>
): EventWindow[] {
  return events.flatMap(e => {
    const startMs = Date.parse(e.starts_at);
    const endMs = Date.parse(e.ends_at);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) return [];
    return [{ eventId: e.id, startMs, endMs, title: e.title, allDay: e.all_day ?? false }];
  });
}
