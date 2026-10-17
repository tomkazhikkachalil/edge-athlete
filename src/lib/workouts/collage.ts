// ── A posted workout's images, in the order a person reads them (Oct 17 2026)
// Pure. Tom: tapping a set's image opens the app's own viewer over the post
// (never a new window), and swiping walks every image of the workout. The
// list follows the detail view: single exercises set by set; a superset /
// circuit round by round, each round's members in order.

import type { EntryExercise, SetMedia } from './entries';
import { GROUP_LABEL, renderItems } from './groups';

/** Shaped like the viewer's CollageItem (components/media/MediaCollage). */
export interface WorkoutMediaItem {
  id: string;
  url: string;
  kind: 'image' | 'video';
  thumbnailUrl: string | null;
  /** "Bench Press · Set 2" / "Circuit · Round 3 · Squat" — the viewer's caption. */
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
        set.media.forEach((m, i) => out.push(item(m, setMediaId(ex.clientId, s, i), `${ex.name} · Set ${set.setNumber}`))),
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

/** The badge on a set's stack: "+2" for three images, nothing for one. */
export function stackBadge(count: number): string | null {
  return count > 1 ? `+${count - 1}` : null;
}
