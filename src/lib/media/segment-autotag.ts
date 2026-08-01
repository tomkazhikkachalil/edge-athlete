/**
 * Guessing which segment a photo belongs to, from when it was taken.
 *
 * Media captured DURING scoring is tagged exactly, because the app knows which
 * hole you were on. Media added afterwards has only its capture time, so this
 * matches that against when each segment was scored.
 *
 * IT IS ALWAYS A SUGGESTION, NEVER A SILENT ASSIGNMENT. Two reasons, and both
 * are why the reassignment UI is mandatory rather than a nice-to-have:
 *
 *  1. `File.lastModified` is not reliably capture time. Some Android pickers
 *     report the moment the file was COPIED, and anything that has been through
 *     an edit or a share sheet can carry a fresh timestamp.
 *  2. A round entered retrospectively has every hole stamped within seconds of
 *     the others, so the timestamps carry no positional information at all —
 *     matching against them would produce confident nonsense.
 *
 * Pure, so all of that is testable; there is no jsdom in this repo.
 */

export interface SegmentTime {
  segment: number;
  /** ms epoch of when this segment was scored. */
  atMs: number;
}

export interface InferSegmentOptions {
  /**
   * How far a capture may sit from the nearest segment and still be attributed
   * to it. Default 20 minutes: a slow par 5 plus a wait on the tee.
   */
  maxGapMs?: number;
  /**
   * Minimum spread across all segment timestamps for them to carry positional
   * information. Below this the card was filled in in one sitting.
   */
  minSpanMs?: number;
}

export interface InferSegmentResult {
  /** The suggested segment, or null when we should not guess. */
  segment: number | null;
  /** `low` means "do not preselect this without showing the athlete". */
  confidence: 'high' | 'low';
  /** Why we declined, for the caller to explain rather than fail silently. */
  reason?: 'no-data' | 'entered-at-once' | 'outside-round' | 'too-far';
}

const DEFAULT_MAX_GAP_MS = 20 * 60 * 1000;
const MIN_SPAN_FLOOR_MS = 15 * 60 * 1000;
/** Per-segment expectation used to scale the span guard to the round's length. */
const MIN_SPAN_PER_SEGMENT_MS = 60 * 1000;

/**
 * Suggest a segment for a capture time.
 *
 * Picks the NEAREST segment rather than "the last one before" — a photo of a
 * putt can easily be taken a moment after the score is entered, and a photo of
 * the tee shot a few minutes before.
 */
export function inferSegment(
  capturedAtMs: number | null | undefined,
  segmentTimes: SegmentTime[] | null | undefined,
  options: InferSegmentOptions = {}
): InferSegmentResult {
  const maxGapMs = options.maxGapMs ?? DEFAULT_MAX_GAP_MS;

  if (
    typeof capturedAtMs !== 'number' ||
    !Number.isFinite(capturedAtMs) ||
    !segmentTimes?.length
  ) {
    return { segment: null, confidence: 'low', reason: 'no-data' };
  }

  const usable = segmentTimes.filter(s => Number.isFinite(s.atMs));
  if (usable.length === 0) return { segment: null, confidence: 'low', reason: 'no-data' };

  const times = usable.map(s => s.atMs);
  const first = Math.min(...times);
  const last = Math.max(...times);

  // THE SPAN GUARD. A whole card entered in one sitting gives every hole
  // effectively the same timestamp, so proximity means nothing. Scale the
  // threshold to the round's length so a 3-hole round is not held to an
  // 18-hole standard.
  const minSpanMs =
    options.minSpanMs ?? Math.max(usable.length * MIN_SPAN_PER_SEGMENT_MS, MIN_SPAN_FLOOR_MS);
  if (last - first < minSpanMs) {
    return { segment: null, confidence: 'low', reason: 'entered-at-once' };
  }

  // A capture from well outside the round is not from the round.
  if (capturedAtMs < first - maxGapMs || capturedAtMs > last + maxGapMs) {
    return { segment: null, confidence: 'low', reason: 'outside-round' };
  }

  let best: { segment: number; gap: number } | null = null;
  for (const s of usable) {
    const gap = Math.abs(s.atMs - capturedAtMs);
    // A photo can sit exactly between two holes, so the tie-break must be on
    // the SEGMENT NUMBER, not on input order. "Strictly closer" alone kept
    // whichever tied row happened to come first in the array, which meant the
    // same photo could be attributed to hole 1 or hole 2 depending on the
    // order rows came back in.
    if (best === null || gap < best.gap || (gap === best.gap && s.segment < best.segment)) {
      best = { segment: s.segment, gap };
    }
  }

  if (!best || best.gap > maxGapMs) {
    return { segment: null, confidence: 'low', reason: 'too-far' };
  }

  return { segment: best.segment, confidence: 'high' };
}

/**
 * Build the timeline `inferSegment` needs from per-hole score rows.
 * Keeps the EARLIEST timestamp per segment — the first time a hole was scored
 * is when it was played; a later edit should not move it.
 */
export function segmentTimesFromScores(
  holeScores: Array<{ hole_number?: number | null; created_at?: string | null }> | null | undefined
): SegmentTime[] {
  if (!holeScores?.length) return [];

  const earliest = new Map<number, number>();
  for (const h of holeScores) {
    if (typeof h.hole_number !== 'number' || !h.created_at) continue;
    const at = Date.parse(h.created_at);
    if (Number.isNaN(at)) continue;
    const prev = earliest.get(h.hole_number);
    if (prev === undefined || at < prev) earliest.set(h.hole_number, at);
  }

  return [...earliest.entries()]
    .map(([segment, atMs]) => ({ segment, atMs }))
    .sort((a, b) => a.segment - b.segment);
}
