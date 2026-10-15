/**
 * The thread list's scroll rules (Tom's fix 6, Oct 14 2026) — pure, zero
 * imports. The list is a plain column; the hook that applies these is the
 * ONE writer of its scrollTop:
 *   · the first load lands at the bottom;
 *   · your own message, or a new one while you are near the bottom, scrolls
 *     to it; a new one while you are reading history shows a pill instead;
 *   · older messages prepended keep what you were looking at in place.
 */
export const STICK_THRESHOLD_PX = 80;

export function distanceFromBottom(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight - scrollTop);
}

export function shouldStickToBottom(distance: number, threshold: number = STICK_THRESHOLD_PX): boolean {
  return distance <= threshold;
}

/** The scrollTop that keeps the same content in view after older rows were added above. */
export function restoreAfterPrepend(prevScrollHeight: number, prevScrollTop: number, nextScrollHeight: number): number {
  return Math.max(0, prevScrollTop + (nextScrollHeight - prevScrollHeight));
}

export type ListChange = 'initial' | 'appended' | 'prepended' | 'none';

export interface ListEdges {
  newestId: string | null;
  oldestId: string | null;
  count: number;
}

export function classifyListChange(prev: ListEdges, next: ListEdges): ListChange {
  if (next.count === 0) return 'none';
  if (prev.count === 0) return 'initial';
  if (next.newestId !== prev.newestId) return 'appended';
  if (next.oldestId !== prev.oldestId && next.count > prev.count) return 'prepended';
  return 'none';
}

export type ArrivalAction = 'scroll' | 'pill' | 'none';

export function arrivalAction(a: { change: ListChange; isOwn: boolean; nearBottom: boolean }): ArrivalAction {
  if (a.change === 'initial') return 'scroll';
  if (a.change !== 'appended') return 'none';
  return a.isOwn || a.nearBottom ? 'scroll' : 'pill';
}
