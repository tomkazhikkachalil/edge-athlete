// ── Rounds as a horizontal stack — the pure rules (workout fixes, Oct 13 2026)
// Tom: "Circuits and repeated rounds make the screen very long … show the
// rounds as a horizontal stack the athlete swipes through — Round 2 of 4, dots,
// the current round in view, auto-advance when a round is complete."
//
// Nothing here touches the DOM. RoundsTrack (the one carousel) and the group
// cards call these; the tests pin them. Zero imports.

export type GroupView = 'swipe' | 'list';

interface RoundSetLike {
  completedAt: string | null;
}
interface RoundMemberLike {
  sets: ReadonlyArray<RoundSetLike>;
}

/** The slide nearest a scroll position (0-based, clamped to the count). */
export function slideIndexFromScroll(scrollLeft: number, slideWidth: number, count: number): number {
  if (count <= 0) return 0;
  if (!(slideWidth > 0) || !Number.isFinite(scrollLeft)) return 0;
  const i = Math.round(scrollLeft / slideWidth);
  return Math.min(count - 1, Math.max(0, i));
}

/** Round k (0-based) is complete when EVERY member's set k is MARKED complete — the explicit tap, not merely data. */
export function roundComplete(members: ReadonlyArray<RoundMemberLike>, k: number): boolean {
  if (members.length === 0 || k < 0) return false;
  return members.every(m => !!m.sets[k]?.completedAt);
}

/** One character per round — the signature the auto-advance effect watches. */
export function completionSignature(members: ReadonlyArray<RoundMemberLike>, rounds: number): string {
  let s = '';
  for (let k = 0; k < rounds; k++) s += roundComplete(members, k) ? '1' : '0';
  return s;
}

/**
 * Where the track goes after a completion: the round in view just became
 * complete (`before` says it was not) and a next round exists → the next;
 * otherwise stay. Swiping back to edit stays possible — this only moves on
 * the false → true edge of the round IN VIEW.
 */
export function advanceAfterComplete(before: string, after: string, current: number, rounds: number): number {
  if (current < 0 || current >= rounds) return Math.min(Math.max(0, current), Math.max(0, rounds - 1));
  if (before[current] !== '1' && after[current] === '1' && current + 1 < rounds) return current + 1;
  return current;
}

/** The slide to show on mount: the first incomplete round (0-based), else the last. */
export function initialSlide(members: ReadonlyArray<RoundMemberLike>, rounds: number): number {
  for (let k = 0; k < rounds; k++) if (!roundComplete(members, k)) return k;
  return Math.max(0, rounds - 1);
}
