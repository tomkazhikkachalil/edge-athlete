/**
 * CPU reference renderer — PURE, node-tested. Runs the exact color-math.ts
 * pipeline over raw RGBA bytes. Two jobs:
 *   1. Pin every formula (tests compare hand-computed values and legacy
 *      byte-parity against applyAdjustments).
 *   2. Export fallback when WebGL2 is unavailable or the context is lost —
 *      render.ts calls this AFTER the downscale, so worst case is a few
 *      O(n) passes over ≤2048² pixels (sub-second, rare devices only).
 *
 * The GPU path in shaders.ts implements the same stages with the same
 * constants; the two must never be edited independently. Detail blurs here
 * mirror the GPU plan (σ=1 full-res, σ=2 at half resolution with bilinear
 * resampling) — bilinear vs hardware filtering can differ by a hair, which
 * is invisible at 8-bit and why blur outputs are pinned by property tests
 * (impulse/flat images) rather than byte tables.
 */

import {
  applyDetail,
  BLUR_BG_SIGMA,
  BLUR_BG_TAPS,
  BLUR_LARGE_SIGMA,
  BLUR_LARGE_TAPS,
  BLUR_SMALL_SIGMA,
  BLUR_SMALL_TAPS,
  clamp01,
  gaussianKernel,
  transformPixel,
  vignetteFalloff,
  type Rgb,
} from './color-math';
import type { EngineParams } from './params';
import { isNeutralPerspective, warpPerspective } from './perspective-math';
import { applyHslLut, bakeHslLut, isNeutralHsl } from './hsl-math';
import { applyCurveLut, bakeCurveLut, isNeutralCurves } from './curves-math';
import {
  applyMaskDeltas,
  isNeutralMasks,
  maskBlurWeight,
  maskDeltas,
  wantsBackgroundBlur,
} from './mask-math';
import { applyGrain, isNeutralGrain } from './grain-math';

/** RGBA bytes → packed RGB floats (0..1). */
function toFloatRgb(data: Uint8ClampedArray): Float32Array {
  const out = new Float32Array((data.length / 4) * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    out[j] = data[i] / 255;
    out[j + 1] = data[i + 1] / 255;
    out[j + 2] = data[i + 2] / 255;
  }
  return out;
}

/** Separable gaussian (H then V), clamp-to-edge — the CPU twin of the
 *  ping-pong blur passes. Exported for the convolution-pinning tests. */
export function separableBlur(
  src: Float32Array,
  width: number,
  height: number,
  sigma: number,
  taps: number
): Float32Array {
  const kernel = gaussianKernel(sigma, taps);
  const half = kernel.length - 1;
  const clampX = (x: number) => (x < 0 ? 0 : x >= width ? width - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y >= height ? height - 1 : y);

  const horizontal = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = -half; k <= half; k++) {
        const j = (y * width + clampX(x + k)) * 3;
        const w = kernel[Math.abs(k)];
        r += src[j] * w;
        g += src[j + 1] * w;
        b += src[j + 2] * w;
      }
      const o = (y * width + x) * 3;
      horizontal[o] = r;
      horizontal[o + 1] = g;
      horizontal[o + 2] = b;
    }
  }

  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = -half; k <= half; k++) {
        const j = (clampY(y + k) * width + x) * 3;
        const w = kernel[Math.abs(k)];
        r += horizontal[j] * w;
        g += horizontal[j + 1] * w;
        b += horizontal[j + 2] * w;
      }
      const o = (y * width + x) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}

/** Bilinear resample at pixel centers (the CPU twin of a LINEAR texture
 *  fetch), clamp-to-edge. Used half-down and back up for the large blur. */
export function resampleBilinear(
  src: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): Float32Array {
  const out = new Float32Array(dstWidth * dstHeight * 3);
  for (let y = 0; y < dstHeight; y++) {
    const sy = ((y + 0.5) / dstHeight) * srcHeight - 0.5;
    const y0 = Math.max(0, Math.min(srcHeight - 1, Math.floor(sy)));
    const y1 = Math.min(srcHeight - 1, y0 + 1);
    const fy = Math.max(0, Math.min(1, sy - y0));
    for (let x = 0; x < dstWidth; x++) {
      const sx = ((x + 0.5) / dstWidth) * srcWidth - 0.5;
      const x0 = Math.max(0, Math.min(srcWidth - 1, Math.floor(sx)));
      const x1 = Math.min(srcWidth - 1, x0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const o = (y * dstWidth + x) * 3;
      for (let c = 0; c < 3; c++) {
        const p00 = src[(y0 * srcWidth + x0) * 3 + c];
        const p10 = src[(y0 * srcWidth + x1) * 3 + c];
        const p01 = src[(y1 * srcWidth + x0) * 3 + c];
        const p11 = src[(y1 * srcWidth + x1) * 3 + c];
        out[o + c] = p00 * (1 - fx) * (1 - fy) + p10 * fx * (1 - fy) + p01 * (1 - fx) * fy + p11 * fx * fy;
      }
    }
  }
  return out;
}

/** Apply the full engine pipeline (detail + color) in place. `width`/
 *  `height` are the pixel dimensions of `data`. */
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
  const needSmall = params.detail.sharpen > 0;
  const needLarge = params.detail.clarity > 0 || params.detail.noiseReduction > 0;

  // Perspective warps FIRST — blurs and color then run on warped pixels,
  // exactly like the GPU's warp → blur → composite ordering.
  if (!isNeutralPerspective(params.perspective)) {
    warpPerspective(data, width, height, params.perspective);
  }

  // Phase-2 stages (masks → mixer → curves): injected between vibrance and
  // vignette as ONE hook (keeps color-math free of their imports — the
  // TDZ-cycle trap class). Skipped when neutral, mirroring the shader's
  // u_maskCount / u_hslEnabled / u_curveEnabled branches.
  const wantMasks = !isNeutralMasks(params.masks);
  const hslLut = isNeutralHsl(params.hsl) ? null : bakeHslLut(params.hsl);
  const curveLut = isNeutralCurves(params.curves) ? null : bakeCurveLut(params.curves);
  const hslApply =
    wantMasks || hslLut || curveLut
      ? (rgb: Rgb, u: number, vv: number): Rgb => {
          let out = rgb;
          if (wantMasks) out = applyMaskDeltas(out, maskDeltas(params.masks, u, vv));
          if (hslLut) out = applyHslLut(out, hslLut);
          if (curveLut) out = applyCurveLut([clamp01(out[0]), clamp01(out[1]), clamp01(out[2])], curveLut);
          return out;
        }
      : undefined;

  const needBg = wantsBackgroundBlur(params.masks);
  let srcFloat: Float32Array | null = null;
  let blurSmall: Float32Array | null = null;
  let blurLarge: Float32Array | null = null;
  let blurBg: Float32Array | null = null;
  if (needSmall || needLarge || needBg) {
    srcFloat = toFloatRgb(data);
    if (needSmall) {
      blurSmall = separableBlur(srcFloat, width, height, BLUR_SMALL_SIGMA, BLUR_SMALL_TAPS);
    }
    if (needLarge) {
      const halfW = Math.max(1, Math.round(width / 2));
      const halfH = Math.max(1, Math.round(height / 2));
      const down = resampleBilinear(srcFloat, width, height, halfW, halfH);
      const blurred = separableBlur(down, halfW, halfH, BLUR_LARGE_SIGMA, BLUR_LARGE_TAPS);
      blurLarge = resampleBilinear(blurred, halfW, halfH, width, height);
    }
    if (needBg) {
      const qw = Math.max(1, Math.round(width / 4));
      const qh = Math.max(1, Math.round(height / 4));
      const down = resampleBilinear(srcFloat, width, height, qw, qh);
      const blurred = separableBlur(down, qw, qh, BLUR_BG_SIGMA, BLUR_BG_TAPS);
      blurBg = resampleBilinear(blurred, qw, qh, width, height);
    }
  }

  for (let y = 0; y < height; y++) {
    // Pixel centers, matching the GPU's gl_FragCoord + 0.5 convention.
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const j = (y * width + x) * 3;
      const falloff = hasVignette ? vignetteFalloff((x + 0.5) / width, v, width, height) : 0;
      let rgb: Rgb = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
      // Mask blur mixes the INPUT (before detail/color) so blurred regions
      // take every later adjustment uniformly — the shader's ordering.
      // Detail bases deliberately stay unmixed, also matching the GPU.
      if (blurBg) {
        const wBlur = maskBlurWeight(params.masks, (x + 0.5) / width, v);
        if (wBlur > 0) {
          rgb = [
            rgb[0] + (blurBg[j] - rgb[0]) * wBlur,
            rgb[1] + (blurBg[j + 1] - rgb[1]) * wBlur,
            rgb[2] + (blurBg[j + 2] - rgb[2]) * wBlur,
          ];
        }
      }
      if (srcFloat) {
        const small: Rgb = blurSmall ? [blurSmall[j], blurSmall[j + 1], blurSmall[j + 2]] : rgb;
        const large: Rgb = blurLarge ? [blurLarge[j], blurLarge[j + 1], blurLarge[j + 2]] : rgb;
        rgb = applyDetail(rgb, small, large, params.detail);
      }
      let out = transformPixel(rgb, pipelineParams, falloff, hslApply, (x + 0.5) / width, v);
      // Grain rides over everything (incl. vignette), matching the shader's
      // last-look placement; the byte write clamps.
      if (!isNeutralGrain(params.grain)) out = applyGrain(out, x, y, params.grain);
      data[i] = out[0] * 255;
      data[i + 1] = out[1] * 255;
      data[i + 2] = out[2] * 255;
    }
  }
}
