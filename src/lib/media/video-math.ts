/**
 * Pure math for the video trim/poster UI. No DOM — unit-tested.
 */

/** Minimum clip length the UI allows (avoids zero/negative-length encodes). */
export const MIN_CLIP_SECONDS = 0.5;

export interface TrimRange {
  start: number;
  end: number;
}

/** Clamp a trim range to [0, duration] keeping at least MIN_CLIP_SECONDS. */
export function clampTrim(range: TrimRange, duration: number): TrimRange {
  const start = Math.min(Math.max(range.start, 0), Math.max(0, duration - MIN_CLIP_SECONDS));
  const end = Math.max(Math.min(range.end, duration), start + MIN_CLIP_SECONDS);
  return { start, end: Math.min(end, duration) };
}

/** Move one handle, respecting bounds and the minimum clip length. */
export function moveTrimHandle(
  range: TrimRange,
  handle: 'start' | 'end',
  time: number,
  duration: number
): TrimRange {
  if (handle === 'start') {
    return clampTrim({ start: Math.min(time, range.end - MIN_CLIP_SECONDS), end: range.end }, duration);
  }
  return clampTrim({ start: range.start, end: Math.max(time, range.start + MIN_CLIP_SECONDS) }, duration);
}

/** Evenly-spaced sample times for the timeline thumbnail strip. */
export function thumbnailTimes(duration: number, count: number): number[] {
  if (duration <= 0 || count <= 0) return [];
  return Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration);
}

/** Split a (possibly trimmed) clip at `time` into two ranges, or null if a
 *  half would be shorter than the minimum. */
export function splitRanges(
  current: TrimRange | null,
  time: number,
  duration: number
): [TrimRange, TrimRange] | null {
  const range = current ?? { start: 0, end: duration };
  if (time < range.start + MIN_CLIP_SECONDS || time > range.end - MIN_CLIP_SECONDS) return null;
  return [
    { start: range.start, end: time },
    { start: time, end: range.end },
  ];
}

/** Timeline x-position (0–1) for a time, and back. */
export function timeToFraction(time: number, duration: number): number {
  return duration > 0 ? Math.min(Math.max(time / duration, 0), 1) : 0;
}
export function fractionToTime(fraction: number, duration: number): number {
  return Math.min(Math.max(fraction, 0), 1) * duration;
}

export function formatClipTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}
