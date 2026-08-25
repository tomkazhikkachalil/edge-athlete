/**
 * Browser glue for auto-enhance — deliberately thin and untested (the math
 * lives in auto-enhance.ts). Samples the SOURCE file at thumbnail size;
 * 256px of pixels is plenty of histogram for percentile targeting.
 */

import { decodeImage } from '../decode';
import { computeHistogram } from './auto-enhance';

const SAMPLE_DIM = 256;

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
