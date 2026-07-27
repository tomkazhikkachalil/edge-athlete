/**
 * Image export pipeline (browser-only). One-shot render at Done — the live
 * preview never touches canvas (react-easy-crop transforms + CSS filter),
 * so this is the only place pixels are actually processed.
 *
 * Pipeline: decode (EXIF baked) → rotate+straighten+crop in ONE transform
 * draw (pre-scaled so no canvas exceeds MAX_CANVAS_DIM — iOS Safari limit)
 * → stepped downscale to the output cap → adjustments+filter (ctx.filter
 * where supported, else the unit-tested pixel fallback) → toBlob.
 */

import { rotatedSize, totalRotation } from './crop-math';
import { applyAdjustments, composeAdjustments, cssFilterString, isNeutral } from './filters';
import { downscaleSteps, fitWithin, MAX_CANVAS_DIM } from './limits';
import { decodeImage } from './decode';
import type { ImageRecipe, OutputConfig } from './types';

let canvasFilterSupport: boolean | null = null;

/** Safari only gained ctx.filter recently — detect, don't assume. */
export function supportsCanvasFilter(): boolean {
  if (canvasFilterSupport !== null) return canvasFilterSupport;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return (canvasFilterSupport = false);
    ctx.filter = 'blur(1px)';
    canvasFilterSupport = ctx.filter !== 'none' && ctx.filter !== '';
  } catch {
    canvasFilterSupport = false;
  }
  return canvasFilterSupport;
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return [canvas, ctx];
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  // Zeroing dimensions releases the backing store immediately on iOS Safari
  canvas.width = 0;
  canvas.height = 0;
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => (blob ? resolve(blob) : reject(new Error('Canvas export failed'))),
      mime,
      quality
    );
  });
}

/** `IMG_1234.HEIC` + image/webp → `IMG_1234-edited.webp` */
export function renderedFileName(originalName: string, mime: string): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'media';
  const ext = mime === 'image/webp' ? 'webp' : 'jpg';
  return `${base}-edited.${ext}`;
}

export async function renderImage(
  file: File,
  recipe: ImageRecipe,
  output: OutputConfig
): Promise<Blob> {
  const decoded = await decodeImage(file);
  try {
    const rotation = totalRotation(recipe.rotate, recipe.straighten);
    const bbox = rotatedSize(decoded.width, decoded.height, rotation);
    const crop = recipe.crop ?? { x: 0, y: 0, width: bbox.width, height: bbox.height };

    // Pre-scale so the working canvas never exceeds the iOS-safe dimension
    const k = Math.min(1, MAX_CANVAS_DIM / Math.max(crop.width, crop.height));
    const [stage, stageCtx] = makeCanvas(crop.width * k, crop.height * k);

    // One transform draw: position the rotated image so the crop region's
    // top-left lands at the canvas origin (crop coords live in rotated-bbox
    // space — react-easy-crop's croppedAreaPixels convention).
    stageCtx.translate((bbox.width / 2 - crop.x) * k, (bbox.height / 2 - crop.y) * k);
    stageCtx.rotate((rotation * Math.PI) / 180);
    stageCtx.drawImage(
      decoded.source,
      (-decoded.width / 2) * k,
      (-decoded.height / 2) * k,
      decoded.width * k,
      decoded.height * k
    );
    decoded.close();

    // Downscale to the output cap (stepped halving preserves detail)
    const target = fitWithin(stage.width, stage.height, output.maxDimension);
    const adjustments = composeAdjustments(recipe.adjustments, recipe.filterId);
    const useCtxFilter = !isNeutral(adjustments) && supportsCanvasFilter();

    let current = stage;
    if (target.scale < 1 || useCtxFilter) {
      const steps = target.scale < 1
        ? downscaleSteps(stage.width, stage.height, target.width, target.height)
        : [{ width: stage.width, height: stage.height }];
      for (let i = 0; i < steps.length; i++) {
        const [next, nextCtx] = makeCanvas(steps[i].width, steps[i].height);
        if (useCtxFilter && i === steps.length - 1) {
          nextCtx.filter = cssFilterString(adjustments);
        }
        nextCtx.drawImage(current, 0, 0, next.width, next.height);
        releaseCanvas(current);
        current = next;
      }
    }

    if (!isNeutral(adjustments) && !useCtxFilter) {
      const ctx = current.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      const imageData = ctx.getImageData(0, 0, current.width, current.height);
      applyAdjustments(imageData.data, adjustments);
      ctx.putImageData(imageData, 0, 0);
    }

    const blob = await toBlob(current, output.mime, output.quality);
    releaseCanvas(current);
    return blob;
  } catch (err) {
    decoded.close();
    throw err;
  }
}
