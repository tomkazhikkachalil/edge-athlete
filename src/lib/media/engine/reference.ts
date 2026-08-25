/**
 * CPU reference renderer — PURE, node-tested. Runs the exact color-math.ts
 * pipeline over raw RGBA bytes. Two jobs:
 *   1. Pin every formula (tests compare hand-computed values and legacy
 *      byte-parity against applyAdjustments).
 *   2. Export fallback when WebGL2 is unavailable or the context is lost —
 *      render.ts calls this AFTER the downscale, so worst case is one O(n)
 *      pass over ≤2048² pixels (a few hundred ms, rare devices only).
 *
 * The GPU path in shaders.ts implements the same stages with the same
 * constants; the two must never be edited independently.
 */

import { transformPixel, vignetteFalloff, type Rgb } from './color-math';
import type { EngineParams } from './params';

/** Apply the full engine color pipeline in place. `width`/`height` are the
 *  pixel dimensions of `data` (needed for the vignette's position term). */
export function applyEngine(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  params: EngineParams
): void {
  const pipelineParams = {
    adjustments: params.adjustments,
    light: params.light,
    color: params.color,
    vignette: params.detail.vignette,
  };
  const hasVignette = params.detail.vignette !== 0;
  for (let y = 0; y < height; y++) {
    // Pixel centers, matching the GPU's gl_FragCoord + 0.5 convention.
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const falloff = hasVignette ? vignetteFalloff((x + 0.5) / width, v, width, height) : 0;
      const rgb: Rgb = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
      const [r, g, b] = transformPixel(rgb, pipelineParams, falloff);
      data[i] = r * 255;
      data[i + 1] = g * 255;
      data[i + 2] = b * 255;
    }
  }
}
