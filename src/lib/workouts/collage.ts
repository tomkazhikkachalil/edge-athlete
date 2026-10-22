// ── A posted workout's images, in the order a person reads them (Oct 17 2026)
// Pure. Tom: tapping an image opens the app's own viewer over the post
// (never a new window), and swiping walks every image of the workout. The
// list follows the detail view: single exercises set by set; a superset /
// circuit round by round, each round's members in order.
// Training: three changes (Oct 22 2026, item 3): on the post a clip belongs
// to the EXERCISE, not to the set it was taken during — `exerciseMedia` and
// `roundMedia` gather a card's clips for ONE strip, the caption names the
// exercise (a group's keeps the round: the round is the group's shape, not a
// set). Storage is unchanged (the set still carries its clips, Convention 37),
// so every existing post reads the same way.

import type { EntryExercise, SetMedia } from './entries';
import { GROUP_LABEL, renderItems } from './groups';

/** Shaped like the viewer's CollageItem (components/media/MediaCollage). */
export interface WorkoutMediaItem {
  id: string;
  url: string;
  kind: 'image' | 'video';
  thumbnailUrl: string | null;
  /** "Bench Press" / "Circuit · Round 3 · Squat" — the viewer's caption. */
  label: string;
}

/** The id of one image: exercise, set (= round in a group), position. */
export function setMediaId(clientId: string, setIndex: number, mediaIndex: number): string {
  return `${clientId}:${setIndex}:${mediaIndex}`;
}

function item(media: SetMedia, id: string, label: string): WorkoutMediaItem {
  return { id, url: media.url, kind: media.type === 'video' ? 'video' : 'image', thumbnailUrl: media.thumbnailUrl ?? null, label };
}

export function workoutCollageItems(exercises: EntryExercise[]): WorkoutMediaItem[] {
  const out: WorkoutMediaItem[] = [];
  for (const entry of renderItems(exercises)) {
    if (entry.type === 'single') {
      const ex = entry.exercise;
      ex.sets.forEach((set, s) =>
        set.media.forEach((m, i) => out.push(item(m, setMediaId(ex.clientId, s, i), ex.name))),
      );
      continue;
    }
    const { kind, members, rounds } = entry.group;
    const count = Math.max(rounds, ...members.map(m => m.sets.length));
    for (let k = 0; k < count; k++) {
      for (const m of members) {
        m.sets[k]?.media.forEach((media, i) =>
          out.push(item(media, setMediaId(m.clientId, k, i), `${GROUP_LABEL[kind]} · Round ${k + 1} · ${m.name}`)),
        );
      }
    }
  }
  return out;
}

/** The badge on a strip that shows `shown` of `total` clips: "+2" for four clips over two tiles, nothing when every clip has a tile. */
export function moreBadge(total: number, shown: number): string | null {
  return total > shown ? `+${total - shown}` : null;
}

/** The badge on a one-tile stack: "+2" for three images, nothing for one. */
export function stackBadge(count: number): string | null {
  return moreBadge(count, 1);
}

/** All of an exercise's clips, set by set — the post's ONE strip per exercise (Oct 22 2026). */
export function exerciseMedia(ex: EntryExercise): SetMedia[] {
  return ex.sets.flatMap(set => set.media);
}

/** The viewer id of an exercise's clip at `index` in `exerciseMedia` order; null past the end. */
export function exerciseMediaIdAt(ex: EntryExercise, index: number): string | null {
  let n = index;
  for (let s = 0; s < ex.sets.length; s++) {
    const len = ex.sets[s].media.length;
    if (n < len) return n >= 0 ? setMediaId(ex.clientId, s, n) : null;
    n -= len;
  }
  return null;
}

/** A round's clips across a group's members, member by member — the round's ONE strip. */
export function roundMedia(members: EntryExercise[], round: number): SetMedia[] {
  return members.flatMap(m => m.sets[round]?.media ?? []);
}

/** The viewer id of a round's clip at `index` in `roundMedia` order; null past the end. */
export function roundMediaIdAt(members: EntryExercise[], round: number, index: number): string | null {
  let n = index;
  for (const m of members) {
    const len = m.sets[round]?.media.length ?? 0;
    if (n < len) return n >= 0 ? setMediaId(m.clientId, round, n) : null;
    n -= len;
  }
  return null;
}
