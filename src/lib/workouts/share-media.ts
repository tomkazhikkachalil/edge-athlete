/**
 * The share step's clip order (workout capture round PR 2, Oct 8 2026).
 * Zero imports; the screen and the tests read it.
 *
 * The post's carousel is the ORDER the athlete chose, so the selection is an
 * ordered list of clip URLs, not a set of indices: a URL survives an edit or
 * a removal elsewhere in the workout (indices shift; URLs do not), an edit
 * swaps the URL in place (`replaceShareUrl`), and a clip removed from its set
 * is pruned (`pruneShareOrder`). `MAX_POST_MEDIA` is the cap at every door.
 *
 * `replaceMediaAt` / `removeMediaAt` are the set-level edits the share step
 * makes to the exercises by position — immutable, same-object when the
 * position does not exist, so the screen's `mutate` is called only for a
 * real change.
 */

export interface ShareClip {
  url: string;
  exerciseIndex: number;
  setIndex: number;
  mediaIndex: number;
}

/** The first `max` clips, in reading order — the default selection. */
export function defaultShareOrder(clips: readonly { url: string }[], max: number): string[] {
  const order: string[] = [];
  for (const clip of clips) {
    if (order.length >= max) break;
    if (!order.includes(clip.url)) order.push(clip.url);
  }
  return order;
}

/** Include (at the end) or exclude a clip; at the cap an include is refused (same array). */
export function toggleShare(order: readonly string[], url: string, max: number): string[] {
  if (order.includes(url)) return order.filter(u => u !== url);
  if (order.length >= max) return order as string[];
  return [...order, url];
}

/** Move a selected clip one place up (-1) or down (+1); same array at the edge or when unselected. */
export function moveShare(order: readonly string[], url: string, dir: -1 | 1): string[] {
  const from = order.indexOf(url);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= order.length) return order as string[];
  const next = [...order];
  next[from] = order[to];
  next[to] = url;
  return next;
}

/** An edit replaced a clip's URL: the order keeps its place. */
export function replaceShareUrl(order: readonly string[], from: string, to: string): string[] {
  if (!order.includes(from)) return order as string[];
  return order.map(u => (u === from ? to : u));
}

/** Drop URLs that no longer exist in the workout (a removed clip). */
export function pruneShareOrder(order: readonly string[], clips: readonly { url: string }[]): string[] {
  const live = new Set(clips.map(c => c.url));
  const next = order.filter(u => live.has(u));
  return next.length === order.length ? (order as string[]) : next;
}

/** The share list: the selected clips in carousel order, then the rest in reading order. */
export function shareList<C extends { url: string }>(clips: readonly C[], order: readonly string[]): { selected: C[]; rest: C[] } {
  const byUrl = new Map(clips.map(c => [c.url, c] as const));
  const selected: C[] = [];
  for (const url of order) {
    const clip = byUrl.get(url);
    if (clip) selected.push(clip);
  }
  const chosen = new Set(order);
  return { selected, rest: clips.filter(c => !chosen.has(c.url)) };
}

interface MediaLike {
  url: string;
  type: 'image' | 'video';
}
interface SetLike {
  media: MediaLike[];
}
interface ExerciseLike {
  sets: SetLike[];
}

function mapMediaAt<E extends ExerciseLike>(
  exercises: E[],
  at: { exerciseIndex: number; setIndex: number; mediaIndex: number },
  transform: (media: MediaLike[]) => MediaLike[]
): E[] {
  const exercise = exercises[at.exerciseIndex];
  const set = exercise?.sets[at.setIndex];
  if (!set || at.mediaIndex < 0 || at.mediaIndex >= (set.media ?? []).length) return exercises;
  return exercises.map((e, ei) =>
    ei !== at.exerciseIndex
      ? e
      : { ...e, sets: e.sets.map((s, si) => (si !== at.setIndex ? s : { ...s, media: transform(s.media ?? []) })) }
  );
}

/** The clip at a position becomes `media` (an edit's new URL). */
export function replaceMediaAt<E extends ExerciseLike>(
  exercises: E[],
  at: { exerciseIndex: number; setIndex: number; mediaIndex: number },
  media: MediaLike
): E[] {
  return mapMediaAt(exercises, at, list => list.map((m, i) => (i === at.mediaIndex ? media : m)));
}

/** The clip at a position leaves its set. */
export function removeMediaAt<E extends ExerciseLike>(
  exercises: E[],
  at: { exerciseIndex: number; setIndex: number; mediaIndex: number }
): E[] {
  return mapMediaAt(exercises, at, list => list.filter((_, i) => i !== at.mediaIndex));
}
