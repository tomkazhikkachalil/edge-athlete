/**
 * Browser glue for auto-enhance — deliberately thin and untested (the math
 * lives in auto-enhance.ts). Samples the SOURCE file at thumbnail size;
 * 256px of pixels is plenty of histogram for percentile targeting.
 */

import { decodeImage } from '../decode';
import { releaseCanvas, renderGeometry } from '../render';
import { computeHistogram } from './auto-enhance';
import type { ImageRecipe } from '../types';

const SAMPLE_DIM = 256;
const REGION_DIM = 512;

/** Average (0..1) RGB of a 5×5 region at normalized (u, v) — origin
 *  top-left — of the FRAMED image (the recipe's geometry, pre-color).
 *  The white-balance eyedropper's sampler. Null when decode fails. */
export async function sampleFrameRegion(
  file: File,
  recipe: ImageRecipe,
  u: number,
  v: number
): Promise<[number, number, number] | null> {
  try {
    const decoded = await decodeImage(file);
    let stage: HTMLCanvasElement | null = null;
    try {
      stage = renderGeometry(decoded, recipe, REGION_DIM);
      const ctx = stage.getContext('2d');
      if (!ctx) return null;
      const x0 = Math.max(0, Math.min(stage.width - 5, Math.round(u * stage.width) - 2));
      const y0 = Math.max(0, Math.min(stage.height - 5, Math.round(v * stage.height) - 2));
      const region = ctx.getImageData(x0, y0, Math.min(5, stage.width), Math.min(5, stage.height)).data;
      let r = 0;
      let g = 0;
      let b = 0;
      const count = region.length / 4;
      for (let i = 0; i < region.length; i += 4) {
        r += region[i];
        g += region[i + 1];
        b += region[i + 2];
      }
      return [r / count / 255, g / count / 255, b / count / 255];
    } finally {
      if (stage) releaseCanvas(stage);
      decoded.close();
    }
  } catch {
    return null;
  }
}

/** Luma histogram of a file's pixels, or null when decode fails. */
export async function sampleFileHistogram(file: File): Promise<Uint32Array | null> {
  try {
    const decoded = await decodeImage(file);
    try {
      const scale = Math.min(1, SAMPLE_DIM / Math.max(decoded.width, decoded.height));
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(decoded.source, 0, 0, width, height);
      const histogram = computeHistogram(ctx.getImageData(0, 0, width, height).data);
      canvas.width = 0;
      canvas.height = 0;
      return histogram;
    } finally {
      decoded.close();
    }
  } catch {
    return null;
  }
}
