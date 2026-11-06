/**
 * The player that knows the time (Videos program polish B, Nov 6 2026) —
 * the pure rules. ZERO imports.
 *
 * The player is YouTube's frame; with YouTube's IFrame Player API when it
 * answers (loaded by trusted code under the CSP's 'strict-dynamic' — no
 * host is added, nothing is parser-inserted), the plain frame otherwise.
 * What the API unlocks lives here as rules: marking the moment on screen,
 * playing the highlights back to back, resuming where the viewer left off.
 * Pinned by player-rules.test.ts.
 */

export const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';
/** The frame's host stays the CSP's (youtube-nocookie.com). */
export const PLAYER_HOST = 'https://www.youtube-nocookie.com';
/** The API has this long to announce itself after the poster tap; then the plain frame renders. */
export const PLAYER_READY_TIMEOUT_MS = 4000;
/** The playhead is read this often while playing. */
export const PLAYER_TICK_MS = 500;

export type PlayerMode = 'api' | 'frame';

// ── Mark this moment ────────────────────────────────────────────────────────
/** YouTube reports seconds (fractional); a marker is whole milliseconds, never negative. */
export function markMomentMs(currentSeconds: number): number | null {
  if (!Number.isFinite(currentSeconds) || currentSeconds < 0) return null;
  return Math.round(currentSeconds * 1000);
}

// ── Play highlights ─────────────────────────────────────────────────────────
/** An open marker (no end) plays this long. */
export const OPEN_HIGHLIGHT_MS = 20_000;

export interface PlaylistItem { id: string; startMs: number; endMs: number }

/** The markers in time order with a definite end each — the list "Play highlights" walks. */
export function playlistOf(highlights: ReadonlyArray<{ id: string; start_ms: number; end_ms: number | null }>): PlaylistItem[] {
  return [...highlights]
    .sort((a, b) => a.start_ms - b.start_ms)
    .map(h => ({ id: h.id, startMs: h.start_ms, endMs: h.end_ms !== null && h.end_ms > h.start_ms ? h.end_ms : h.start_ms + OPEN_HIGHLIGHT_MS }));
}

/** While item `index` plays and the playhead is at `currentMs`: stay, or the next index, or null when the list is done. */
export function nextInPlaylist(list: readonly PlaylistItem[], index: number, currentMs: number): { action: 'stay' } | { action: 'next'; index: number } | { action: 'done' } {
  const cur = list[index];
  if (!cur) return { action: 'done' };
  if (currentMs < cur.endMs) return { action: 'stay' };
  return index + 1 < list.length ? { action: 'next', index: index + 1 } : { action: 'done' };
}

/** The row to show as active for a playhead: the last marker that started at or before it (null before the first). */
export function activeHighlightAt(highlights: ReadonlyArray<{ id: string; start_ms: number }>, currentMs: number): string | null {
  let active: string | null = null;
  for (const h of [...highlights].sort((a, b) => a.start_ms - b.start_ms)) {
    if (h.start_ms <= currentMs) active = h.id;
    else break;
  }
  return active;
}

// ── Resume ──────────────────────────────────────────────────────────────────
export const RESUME_KEY_PREFIX = 'ea-video-resume:';
/** Nothing under half a minute is worth resuming. */
export const RESUME_MIN_MS = 30_000;
/** Within the last half minute (or past the end) the video is done — no offer, the position is cleared. */
export const RESUME_TAIL_MS = 30_000;
/** A position is saved this often while playing. */
export const RESUME_SAVE_EVERY_MS = 5_000;

export function resumeKeyFor(videoId: string): string {
  return `${RESUME_KEY_PREFIX}${videoId}`;
}

/** The chip's offer, or null: a saved position worth resuming given what is known of the duration. */
export function resumeOffer(savedMs: number | null | undefined, durationMs: number | null): number | null {
  if (typeof savedMs !== 'number' || !Number.isFinite(savedMs) || savedMs < RESUME_MIN_MS) return null;
  if (durationMs !== null && durationMs > 0 && savedMs >= durationMs - RESUME_TAIL_MS) return null;
  return Math.round(savedMs);
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The browser's localStorage, or null where it is absent or throws (a private window, blocked site data). */
export function defaultPlayerStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function readResumeMs(storage: StorageLike | null, videoId: string): number | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(resumeKeyFor(videoId));
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

export function writeResumeMs(storage: StorageLike | null, videoId: string, ms: number): void {
  if (!storage) return;
  try {
    storage.setItem(resumeKeyFor(videoId), String(Math.round(ms)));
  } catch {
    /* fail-open */
  }
}

export function clearResumeMs(storage: StorageLike | null, videoId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(resumeKeyFor(videoId));
  } catch {
    /* fail-open */
  }
}
