// ── Slide to go live (golf part 2, Nov 24 2026) ──────────────────────────────
// Pure, zero imports. The Start step's Go Live is a slide, not a tap: the
// key travels along a recessed track; released past 85 % of the travel it
// locks and the round goes live, released earlier it springs back and
// nothing happens. The component holds the pointer; this holds the numbers.

/** The key is 48 px and rests 4 px from the track's left edge and from its
 *  right edge at the end: the travel is the track's width minus 56. */
export const SLIDE_KEY = 48;
export const SLIDE_INSET = 4;
export const SLIDE_LOCK_AT = 0.85;

/** How far the key can travel in a track this wide (never negative). */
export function slideTravel(trackWidth: number): number {
  if (!Number.isFinite(trackWidth)) return 0;
  return Math.max(0, trackWidth - SLIDE_KEY - SLIDE_INSET * 2);
}

/** The key's offset for a drag of `dx` px: clamped to the travel, so the
 *  key never leaves its track in either direction. */
export function slideOffset(dx: number, travel: number): number {
  if (!Number.isFinite(dx) || travel <= 0) return 0;
  return Math.min(travel, Math.max(0, dx));
}

/** A release at this offset goes live. A track with no travel never locks
 *  (a zero-width track must not fire on a stray tap). */
export function slideLocks(offset: number, travel: number): boolean {
  return travel > 0 && offset >= travel * SLIDE_LOCK_AT;
}

/** The red trail behind the key: from the left edge to just behind it. */
export function slideTrailWidth(offset: number): number {
  return Math.max(0, offset) + 30;
}
