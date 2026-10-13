// ── The poster rule, pure (video posters program, Oct 13 2026) ──────────────
// Tom: "Pull a frame from about one second in, since the very first frame is
// often dark or blurry." One spelling for every grab — the composer, the
// event gallery, the workout clips, the server job (its own `posterSeekFor`
// mirrors this). Zero imports.

/** "About one second in." */
export const POSTER_TARGET_SEC = 1.0;
/** The first grab, right after the tile is on screen (Capture v2's number). */
export const POSTER_GRAB_DEADLINE_MS = 6_000;
/** The second grab, after the main upload landed and the device is idle. */
export const POSTER_RETRY_DEADLINE_MS = 10_000;
/** Device attempts before the server job takes the poster. */
export const MAX_DEVICE_POSTER_ATTEMPTS = 2;

/**
 * The frame to grab: 1.0 s; a clip shorter than two seconds uses its
 * midpoint (its "one second in" would be its last frame); an unknown
 * duration (MediaRecorder's Infinity, NaN, 0) asks for 1.0 — the capture's
 * own seek clamps to the real end once it is known.
 */
export function posterTimeFor(durationSeconds: number | null | undefined): number {
  if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return POSTER_TARGET_SEC;
  if (durationSeconds < 2 * POSTER_TARGET_SEC) return durationSeconds / 2;
  return POSTER_TARGET_SEC;
}

export type PosterFailure = 'decode' | 'timeout' | 'canvas' | 'upload';

export type PosterPlan =
  /** The grab timed out or the canvas refused: try once more after the main upload, with a longer deadline. */
  | { action: 'retry-after-upload'; deadlineMs: number }
  /** The grab was fine; its UPLOAD failed: re-queue the blob now. */
  | { action: 'retry-now' }
  /** The browser cannot decode the file (Android + HEVC) or the attempts are spent: the server job takes it. */
  | { action: 'server' };

/** What to do after a poster attempt failed. `attempts` counts the one that just failed. */
export function planPosterRetry(attempts: number, failure: PosterFailure): PosterPlan {
  if (failure === 'decode') return { action: 'server' };
  if (failure === 'upload') return { action: 'retry-now' };
  if (attempts >= MAX_DEVICE_POSTER_ATTEMPTS) return { action: 'server' };
  return { action: 'retry-after-upload', deadlineMs: POSTER_RETRY_DEADLINE_MS };
}
