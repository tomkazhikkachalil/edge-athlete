// ── What a session screen knows about its own progress (resume pill, Oct 2026)
// The server's drafts list is fetched ONCE per page load (useDrafts); the
// number the pill shows — sets logged, holes scored — changes on the
// session's own screen, which publishes it here as it changes. The pill
// prefers this over the server snapshot, so the moment you leave the
// workout the pill says what you just did, with no request. A module store
// in the useSyncExternalStore shape (install/store.ts); keyed by kind + id,
// so a stale entry for a finished thing is never read.

import type { DraftKind } from '@/lib/drafts/list';

export interface SessionProgress {
  /** Golf: the viewer's holes scored, and the round's length when known. */
  holesCompleted?: number;
  holesPlayed?: number;
  /** Workouts: sets with something in them (summary.ts's rule). */
  setsCompleted?: number;
  /** Recordings: the live distance in metres (PR 2). */
  distanceM?: number | null;
}

const entries = new Map<string, SessionProgress>();
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (kind: DraftKind, id: string) => `${kind}:${id}`;

export function publishProgress(kind: DraftKind, id: string, progress: SessionProgress): void {
  const key = keyOf(kind, id);
  const prev = entries.get(key);
  if (prev && prev.holesCompleted === progress.holesCompleted && prev.holesPlayed === progress.holesPlayed && prev.setsCompleted === progress.setsCompleted && prev.distanceM === progress.distanceM) return;
  entries.set(key, { ...progress });
  version += 1;
  for (const fn of listeners) fn();
}

export function readProgress(kind: DraftKind, id: string): SessionProgress | null {
  return entries.get(keyOf(kind, id)) ?? null;
}

export function subscribeProgress(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The store's version — a primitive snapshot for useSyncExternalStore. */
export function getProgressVersion(): number {
  return version;
}

/** Tests only. */
export function resetProgressForTests(): void {
  entries.clear();
  version = 0;
}
