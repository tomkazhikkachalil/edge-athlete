// ── The resume store (Videos program Phase 2, Nov 5 2026) ───────────────────
// Where a resumable upload stopped, kept across a retry AND a reload: the
// service's upload URL, the server-minted key and its signed token, the
// file's size and type, the time. Pure over an injected Storage-like
// (localStorage in the browser; a Map in the tests) and fail-open — a
// storage that throws (Safari private mode) means "start over", never an
// error. The TTL is the service's URL life less an hour (tus.ts).

import { isResumeEntry, resumeEntryUsable, type ResumeEntry } from './tus';

export const RESUME_KEY_PREFIX = 'ea-upload-resume:';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function resumeStorageKey(resumeKey: string): string {
  return `${RESUME_KEY_PREFIX}${resumeKey}`;
}

/** The browser's localStorage, or null where it is absent or throws. */
export function defaultResumeStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readResumeEntry(storage: StorageLike | null, resumeKey: string, file: { size: number; type: string }, now: number): ResumeEntry | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(resumeStorageKey(resumeKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isResumeEntry(parsed) || !resumeEntryUsable(parsed, file, now)) {
      storage.removeItem(resumeStorageKey(resumeKey));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeResumeEntry(storage: StorageLike | null, resumeKey: string, entry: ResumeEntry): void {
  if (!storage) return;
  try {
    storage.setItem(resumeStorageKey(resumeKey), JSON.stringify(entry));
  } catch {
    /* quota or private mode — the retry starts over, nothing else is lost */
  }
}

export function clearResumeEntry(storage: StorageLike | null, resumeKey: string): void {
  if (!storage) return;
  try {
    storage.removeItem(resumeStorageKey(resumeKey));
  } catch {
    /* nothing to clear */
  }
}
