/**
 * Pure geometry for the crop/rotate pipeline. No DOM — unit-tested in the
 * Node-only vitest setup. The render pipeline and the editor UI both consume
 * these so preview and export can never disagree.
 */

import type { AspectRatioId, CropRect } from './types';

/** 'free' → null; '4:5' → 0.8. */
export function parseAspectRatio(id: AspectRatioId): number | null {
  if (id === 'free') return null;
  const [w, h] = id.split(':').map(Number);
  return w / h;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Bounding box of a w×h rectangle rotated by `degrees`
 * (react-easy-crop's rotateSize — must match, since CropRect lives in this
 * rotated-bounding-box space).
 */
export function rotatedSize(
  width: number,
  height: number,
  degrees: number
): { width: number; height: number } {
  const rad = Math.abs(degrees % 360) * DEG_TO_RAD;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    width: width * cos + height * sin,
    height: width * sin + height * cos,
  };
}

/** Clamp a crop rect fully inside bounds, preserving its size where possible. */
export function clampCrop(
  crop: CropRect,
  bounds: { width: number; height: number }
): CropRect {
  const width = Math.min(crop.width, bounds.width);
  const height = Math.min(crop.height, bounds.height);
  return {
    width,
    height,
    x: Math.min(Math.max(crop.x, 0), bounds.width - width),
    y: Math.min(Math.max(crop.y, 0), bounds.height - height),
  };
}

/**
 * Scale a crop rect by a uniform factor (rounded to whole pixels). The crop
 * tool measures against a possibly-downscaled flipped preview; the recipe
 * stores source-resolution coordinates — this is the bridge (factor k going
 * in, 1/k coming out).
 */
export function scaleRect(rect: CropRect, factor: number): CropRect {
  return {
    x: Math.max(0, Math.round(rect.x * factor)),
    y: Math.max(0, Math.round(rect.y * factor)),
    width: Math.max(1, Math.round(rect.width * factor)),
    height: Math.max(1, Math.round(rect.height * factor)),
  };
}

/**
 * Total rotation of an image recipe: quarter turns plus the straighten angle.
 * Kept here so the UI (react-easy-crop `rotation`) and the export pipeline
 * share one definition.
 */
export function totalRotation(rotate: number, straighten: number): number {
  return rotate + straighten;
}
