/**
 * Post-time resize for photos the person never opened in the editor (speed
 * round 2, C4 — Oct 4 2026). An unedited camera photo used to upload at its
 * full size (12 MP, several MB); every viewer then paid for it, and so did the
 * optimizer's source fetch. At POST — never at attach: Capture v2's rule is
 * that nothing heavy runs between the camera's hand-back and the tile — a
 * photo over the composer's own cap is re-encoded through the SAME render the
 * editor uses, and the original rides the background path (`deferOriginal`),
 * so the post still keeps its full-resolution source for re-editing without
 * waiting on it.
 *
 * `shouldResize` is the pure decision, pinned: only JPEG / PNG / WebP (a GIF
 * would lose its animation; HEIC never reaches here — it is editor-first),
 * only when the longest edge exceeds the cap.
 */

import type { OutputConfig } from './types';

export const RESIZABLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface ResizeDecision {
  resize: boolean;
  reason: 'fits' | 'type' | 'unknown-size' | 'oversize';
}

export function shouldResize(
  dims: { width: number; height: number } | null,
  type: string,
  maxDimension: number
): ResizeDecision {
  if (!RESIZABLE_TYPES.has(type)) return { resize: false, reason: 'type' };
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) return { resize: false, reason: 'unknown-size' };
  if (Math.max(dims.width, dims.height) <= maxDimension) return { resize: false, reason: 'fits' };
  return { resize: true, reason: 'oversize' };
}

/** The output mime for a resized photo: PNG keeps PNG (transparency), everything else JPEG. */
export function resizedMime(type: string, preferred: OutputConfig['mime']): OutputConfig['mime'] {
  return type === 'image/png' ? 'image/png' : preferred;
}

export interface PreparedImage {
  /** What uploads as the post's media — the render when resized, else the file. */
  file: File;
  /** The untouched original when it was resized (uploads in the background). */
  original?: File;
  width?: number;
  height?: number;
  resized: boolean;
}

/**
 * Browser-only. Never throws: any failure uploads the original as before.
 */
export async function prepareImageForUpload(file: File, output: OutputConfig): Promise<PreparedImage> {
  try {
    const { probeImageDims } = await import('./probe');
    const dims = await probeImageDims(file);
    const decision = shouldResize(dims, file.type, output.maxDimension);
    if (!decision.resize) return { file, width: dims?.width, height: dims?.height, resized: false };
    const [{ renderImage, renderedFileName }, { defaultImageRecipe }] = await Promise.all([
      import('./render'),
      import('./recipes'),
    ]);
    const mime = resizedMime(file.type, output.mime);
    const blob = await renderImage(file, defaultImageRecipe(), { ...output, mime });
    const outMime = (blob.type || mime) as OutputConfig['mime'];
    const rendered = new File([blob], renderedFileName(file.name, outMime), { type: outMime });
    const outDims = await probeImageDims(blob);
    return { file: rendered, original: file, width: outDims?.width, height: outDims?.height, resized: true };
  } catch (err) {
    console.warn('[upload] post-time resize failed; uploading the original:', err);
    return { file, resized: false };
  }
}
