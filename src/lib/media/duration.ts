/**
 * Human-readable clip length for the duration badge on video tiles.
 *
 * Lives in lib rather than beside the tile so it is unit-testable — the repo
 * has no jsdom, so anything importing `next/image` cannot be tested at all.
 */

/** 95 → "1:35", 3671 → "1:01:11", 0 → "0:00". */
export function formatDuration(totalSeconds: number): string {
  // Guard rather than render "NaN:NaN": duration comes from video metadata,
  // and MediaRecorder files famously report Infinity until force-seeked.
  if (!Number.isFinite(totalSeconds)) return '0:00';

  const s = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return hours > 0
    ? `${hours}:${mm}:${String(seconds).padStart(2, '0')}`
    : `${mm}:${String(seconds).padStart(2, '0')}`;
}
