/**
 * Image export pipeline (browser-only). One-shot render at Done — the live
 * preview runs the same WebGL engine at preview resolution (EnginePreview),
 * so preview and export share one set of formulas.
 *
 * Pipeline: decode (EXIF baked) → flip+rotate+straighten+crop in ONE
 * transform draw (pre-scaled so no canvas exceeds MAX_CANVAS_DIM — iOS
 * Safari limit) → stepped downscale to the output cap → color:
 *   - legacy-trio-only recipes: ctx.filter where supported, else the
 *     unit-tested pixel fallback (byte-parity path, unchanged since v1)
 *   - anything the engine round added (light/color/detail): the WebGL
 *     engine at OUTPUT size, falling back to the reference pixel loop
 * → toBlob.
 */

import { rotatedSize, totalRotation } from './crop-math';
import { applyAdjustments, cssFilterString, isNeutral } from './filters';
import { downscaleSteps, fitWithin, MAX_CANVAS_DIM } from './limits';
import { decodeImage, type DecodedImage } from './decode';
import { hasAdvancedParams, recipeToEngineParams } from './engine/params';
import { renderEngineOnCanvas } from './engine/engine';
import { applyEngine } from './engine/reference';
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

export function releaseCanvas(canvas: HTMLCanvasElement): void {
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
  const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
  return `${base}-edited.${ext}`;
}

/**
 * The recipe's GEOMETRY (flip → rotate+straighten → crop) as one transform
 * draw, pre-scaled so the canvas never exceeds `maxDim`. Shared by export
 * and the live EnginePreview so the two can never frame differently. Does
 * NOT close `decoded` — the caller owns it.
 */
export function renderGeometry(
  decoded: DecodedImage,
  recipe: ImageRecipe,
  maxDim: number
): HTMLCanvasElement {
  const rotation = totalRotation(recipe.rotate, recipe.straighten);
  const bbox = rotatedSize(decoded.width, decoded.height, rotation);
  const crop = recipe.crop ?? { x: 0, y: 0, width: bbox.width, height: bbox.height };

  // Pre-scale so the working canvas never exceeds the iOS-safe dimension
  const k = Math.min(1, maxDim / Math.max(crop.width, crop.height));
  const [stage, stageCtx] = makeCanvas(crop.width * k, crop.height * k);

  // One transform draw: position the rotated image so the crop region's
  // top-left lands at the canvas origin (crop coords live in rotated-bbox
  // space — react-easy-crop's croppedAreaPixels convention). Flip is the
  // INNERMOST transform — applied to the source before rotation — so crop
  // coordinates need no translation when a flip toggles.
  stageCtx.translate((bbox.width / 2 - crop.x) * k, (bbox.height / 2 - crop.y) * k);
  stageCtx.rotate((rotation * Math.PI) / 180);
  stageCtx.scale(recipe.flipH ? -1 : 1, recipe.flipV ? -1 : 1);
  stageCtx.drawImage(
    decoded.source,
    (-decoded.width / 2) * k,
    (-decoded.height / 2) * k,
    decoded.width * k,
    decoded.height * k
  );
  return stage;
}

export async function renderImage(
  file: File,
  recipe: ImageRecipe,
  output: OutputConfig
): Promise<Blob> {
  const decoded = await decodeImage(file);
  let stage: HTMLCanvasElement;
  try {
    stage = renderGeometry(decoded, recipe, MAX_CANVAS_DIM);
  } finally {
    decoded.close();
  }

  // Downscale to the output cap (stepped halving preserves detail)
  const target = fitWithin(stage.width, stage.height, output.maxDimension);
  const params = recipeToEngineParams(recipe);
  const advanced = hasAdvancedParams(params);
  // Legacy fast path only when nothing engine-only is in play — the engine
  // applies the trio itself, so the two must never both run.
  const useCtxFilter = !advanced && !isNeutral(params.adjustments) && supportsCanvasFilter();

  let current = stage;
  if (target.scale < 1 || useCtxFilter) {
    const steps = target.scale < 1
      ? downscaleSteps(stage.width, stage.height, target.width, target.height)
      : [{ width: stage.width, height: stage.height }];
    for (let i = 0; i < steps.length; i++) {
      const [next, nextCtx] = makeCanvas(steps[i].width, steps[i].height);
      if (useCtxFilter && i === steps.length - 1) {
        nextCtx.filter = cssFilterString(params.adjustments);
      }
      nextCtx.drawImage(current, 0, 0, next.width, next.height);
      releaseCanvas(current);
      current = next;
    }
  }

  if (advanced) {
    // Engine pass at OUTPUT size (preview ≤2048 ≈ export sizes, and any
    // future sharpen radius matches output pixels). GPU when available,
    // else the node-tested reference loop — never a silently-skipped edit.
    if (!renderEngineOnCanvas(current, params)) {
      const ctx = current.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      const imageData = ctx.getImageData(0, 0, current.width, current.height);
      applyEngine(imageData.data, current.width, current.height, params);
      ctx.putImageData(imageData, 0, 0);
    }
  } else if (!isNeutral(params.adjustments) && !useCtxFilter) {
    const ctx = current.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    const imageData = ctx.getImageData(0, 0, current.width, current.height);
    applyAdjustments(imageData.data, params.adjustments);
    ctx.putImageData(imageData, 0, 0);
  }

  const blob = await toBlob(current, output.mime, output.quality);
  releaseCanvas(current);
  return blob;
}
