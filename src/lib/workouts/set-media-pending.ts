/**
 * A workout clip that is attached but not yet uploaded (workout capture
 * round, Oct 8 2026). Zero imports — the hook, the editor screen and the
 * tests all read it.
 *
 * Why a clip lives IN the set's media array: a capture must become a tile
 * the instant the camera hands it back (Capture v2's rule, Sep 3 2026) and
 * must survive the page being thrown away while the native camera is up
 * (iOS does that; the Sep 3 rounds measured it). The set's media array
 * already rides the localStorage draft on every change and the sets are
 * keyed by index, so a pending entry `{ url: 'pending:<localId>', type }`
 * is persisted for free, moves with its set when sets are deleted or
 * renumbered, and needs no second registry. The bytes live in IndexedDB
 * (`media-stash.ts`) under the same localId; the upload queue replaces the
 * pending URL with the stored one when it lands.
 *
 * The server never sees a pending entry: every entries PUT body goes
 * through `stripPendingMedia` (the server's `isAllowedMediaUrl` would
 * refuse the scheme by name anyway — stripping keeps the save of the
 * OTHER sets flowing while a clip is still uploading).
 */

export const PENDING_MEDIA_PREFIX = 'pending:';

interface PendingSetMedia {
  url: string;
  type: 'image' | 'video';
}
interface PendingEntrySet {
  media: PendingSetMedia[];
}
interface PendingEntryExercise {
  sets: PendingEntrySet[];
}

export function pendingUrl(localId: string): string {
  return `${PENDING_MEDIA_PREFIX}${localId}`;
}

/** The localId of a pending URL, or null for a stored one. */
export function pendingIdOf(url: string): string | null {
  return url.startsWith(PENDING_MEDIA_PREFIX) && url.length > PENDING_MEDIA_PREFIX.length
    ? url.slice(PENDING_MEDIA_PREFIX.length)
    : null;
}

export function isPendingMedia(media: { url: string }): boolean {
  return pendingIdOf(media.url) !== null;
}

/** Every pending localId across the workout, in reading order. */
export function pendingLocalIds<E extends PendingEntryExercise>(exercises: readonly E[]): string[] {
  const ids: string[] = [];
  for (const exercise of exercises) {
    for (const set of exercise.sets) {
      for (const media of set.media ?? []) {
        const id = pendingIdOf(media.url);
        if (id) ids.push(id);
      }
    }
  }
  return ids;
}

/**
 * The exercises with every pending clip removed — what a PUT body carries.
 * Returns the SAME array when nothing is pending, so callers that compare
 * identity (and the debounced sync) see no change.
 */
export function stripPendingMedia<E extends PendingEntryExercise>(exercises: E[]): E[] {
  let changed = false;
  const next = exercises.map(exercise => {
    let setsChanged = false;
    const sets = exercise.sets.map(set => {
      const media = set.media ?? [];
      if (!media.some(isPendingMedia)) return set;
      setsChanged = true;
      return { ...set, media: media.filter(m => !isPendingMedia(m)) };
    });
    if (!setsChanged) return exercise;
    changed = true;
    return { ...exercise, sets };
  });
  return changed ? next : exercises;
}

function mapMedia<E extends PendingEntryExercise>(
  exercises: E[],
  localId: string,
  transform: (media: PendingSetMedia[]) => PendingSetMedia[]
): E[] {
  const target = pendingUrl(localId);
  let changed = false;
  const next = exercises.map(exercise => {
    let setsChanged = false;
    const sets = exercise.sets.map(set => {
      const media = set.media ?? [];
      if (!media.some(m => m.url === target)) return set;
      setsChanged = true;
      return { ...set, media: transform(media) };
    });
    if (!setsChanged) return exercise;
    changed = true;
    return { ...exercise, sets };
  });
  return changed ? next : exercises;
}

/** The pending clip's URL becomes the stored one; same array when it is gone. */
export function replacePendingMedia<E extends PendingEntryExercise>(exercises: E[], localId: string, url: string): E[] {
  const target = pendingUrl(localId);
  return mapMedia(exercises, localId, media => media.map(m => (m.url === target ? { ...m, url } : m)));
}

/** The pending clip leaves its set; same array when it is already gone. */
export function removePendingMedia<E extends PendingEntryExercise>(exercises: E[], localId: string): E[] {
  const target = pendingUrl(localId);
  return mapMedia(exercises, localId, media => media.filter(m => m.url !== target));
}
