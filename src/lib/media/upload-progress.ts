/**
 * Upload progress math (direct-upload round, Oct 4 2026). Pure — the composer
 * turns these into a per-tile percentage and one line by the Post button. A
 * long upload with no number on screen reads as a hang; this is the number.
 */

export interface UploadPart {
  bytes: number;
  /** 0..1 of THIS part's bytes sent. */
  fraction: number;
}

/** Byte-weighted 0..1 over several parts (the render + the original + the poster). */
export function weightedProgress(parts: UploadPart[]): number {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.bytes), 0);
  if (total <= 0) return 0;
  const sent = parts.reduce((sum, p) => sum + Math.max(0, p.bytes) * clamp01(p.fraction), 0);
  return clamp01(sent / total);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * "Uploading 2 of 3 · 45%" — the item in flight is the first unfinished one;
 * the percent is ITS progress (a per-file number moves; an overall one over
 * a 2 KB poster and a 40 MB video barely does). Null when nothing uploads.
 */
export function uploadingLine(fractions: Array<number | undefined>): string | null {
  const total = fractions.length;
  if (total === 0) return null;
  const index = fractions.findIndex(f => f === undefined || f < 1);
  if (index === -1) return null;
  const pct = Math.round(clamp01(fractions[index] ?? 0) * 100);
  return total === 1 ? `Uploading · ${pct}%` : `Uploading ${index + 1} of ${total} · ${pct}%`;
}
