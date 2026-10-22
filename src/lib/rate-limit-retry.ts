/**
 * What the app does with a 429 (Oct 22 2026, Tom: "make sure the app handles
 * it without losing data: an unposted workout or activity stays saved as a
 * draft and retries, and the user sees a friendly message"). Pure, zero
 * imports — the editor and the recorder read the header through this.
 */

/** The server's 429 body for the general write bucket (rate-limit-core.ts). */
export const SLOW_DOWN_MESSAGE = 'Slow down — try again in a moment.';

/** A retry never waits longer than this, whatever the header says. */
export const RETRY_AFTER_CAP_MS = 30_000;

/** Retry-After (seconds) → milliseconds to wait, capped; a missing or odd header waits two seconds. */
export function retryAfterMs(header: string | null | undefined, capMs = RETRY_AFTER_CAP_MS): number {
  const seconds = Number(header);
  if (!Number.isFinite(seconds) || seconds <= 0) return Math.min(2_000, capMs);
  return Math.min(Math.round(seconds * 1000), capMs);
}
