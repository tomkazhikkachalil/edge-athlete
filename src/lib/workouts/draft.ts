/**
 * Workout draft persistence — belt (localStorage) + suspenders (keepalive
 * flush, handled in the editor). Mirrors lib/golf/score-entry.ts.
 *
 * Unlike golf's per-hole merge, workout entries sync as whole snapshots, so
 * resolution is snapshot-vs-snapshot: the draft wins iff it is strictly
 * newer than the server's last entries write.
 */

import type { EntryExercise } from './entries';

export interface WorkoutDraft {
  v: 1;
  sessionId: string;
  savedAt: number; // epoch ms
  title: string | null;
  exercises: EntryExercise[];
}

export const DRAFT_TTL_MS = 48 * 60 * 60 * 1000;

/** Fixed pseudo-id for the manual (not-yet-saved) workout editor. */
export const MANUAL_DRAFT_ID = 'manual';

export function draftKey(sessionId: string): string {
  return `ea:workout-draft:v1:${sessionId}`;
}

// SSR-safe, private-mode-safe storage access (silent no-op on failure)
function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch { /* ignore */ }
}
function storageRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch { /* ignore */ }
}

export function parseDraft(
  raw: string | null,
  sessionId: string,
  now: number = Date.now()
): WorkoutDraft | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as WorkoutDraft;
    if (draft.v !== 1) return null;
    if (draft.sessionId !== sessionId) return null;
    if (typeof draft.savedAt !== 'number' || now - draft.savedAt > DRAFT_TTL_MS) return null;
    if (!Array.isArray(draft.exercises)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function readDraft(sessionId: string, now: number = Date.now()): WorkoutDraft | null {
  return parseDraft(storageGet(draftKey(sessionId)), sessionId, now);
}

export function writeDraft(
  sessionId: string,
  data: { title: string | null; exercises: EntryExercise[] },
  now: number = Date.now()
): void {
  const draft: WorkoutDraft = { v: 1, sessionId, savedAt: now, ...data };
  storageSet(draftKey(sessionId), JSON.stringify(draft));
}

export function clearDraft(sessionId: string): void {
  storageRemove(draftKey(sessionId));
}

/**
 * Snapshot-vs-snapshot resolution: the draft applies only when strictly
 * newer than the server's last entries write (ties → server, which is the
 * safer side — the server copy was durably acknowledged).
 */
export function resolveEntries(
  server: EntryExercise[],
  serverUpdatedAtMs: number,
  draft: WorkoutDraft | null
): { exercises: EntryExercise[]; title: string | null; fromDraft: boolean } {
  if (draft && draft.savedAt > serverUpdatedAtMs) {
    return { exercises: draft.exercises, title: draft.title, fromDraft: true };
  }
  return { exercises: server, title: null, fromDraft: false };
}
