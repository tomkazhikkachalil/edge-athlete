import { describe, it, expect } from 'vitest';
import {
  BLUR_LARGE_FRAGMENT,
  BLUR_SMALL_FRAGMENT,
  COPY_FRAGMENT,
  FRAGMENT_SHADER,
  VERTEX_SHADER,
  WARP_FRAGMENT,
} from '../shaders';
import { PERSPECTIVE_SCALE } from '../perspective-math';
import {
  HSL_GRAY_GUARD,
  HSL_HUE_RANGE_DEG,
  HSL_LUM_RANGE,
  HSL_SAT_RANGE,
} from '../hsl-math';
import {
  BLUR_LARGE_SIGMA,
  BLUR_LARGE_TAPS,
  BLUR_SMALL_SIGMA,
  BLUR_SMALL_TAPS,
  CLARITY_SCALE,
  EXPOSURE_EV_RANGE,
  gaussianKernel,
  LUMA_B,
  LUMA_G,
  LUMA_R,
  NR_EDGE_HI,
  NR_EDGE_LO,
  SAT_B,
  SAT_G,
  SAT_R,
  SHARPEN_SCALE,
  TONE_POINT_SCALE,
  TONE_SCALE,
  VIBRANCE_SCALE,
  VIGNETTE_INNER,
  VIGNETTE_SCALE,
  WB_TEMP_SCALE,
  WB_TINT_SCALE,
} from '../color-math';

// The GLSL is built by interpolating color-math.ts constants — these tests
// pin that the interpolation actually happened, so the GPU pipeline cannot
// silently drift from the node-tested reference math.
describe('shader sources embed the color-math constants', () => {
  it('both shaders are GLSL ES 3.00', () => {
    expect(VERTEX_SHADER.startsWith('#version 300 es')).toBe(true);
    expect(FRAGMENT_SHADER.startsWith('#version 300 es')).toBe(true);
  });

  it('luma and CSS-saturate constants appear verbatim', () => {
    for (const c of [LUMA_R, LUMA_G, LUMA_B, SAT_R, SAT_G, SAT_B]) {
      expect(FRAGMENT_SHADER).toContain(String(c));
    }
    // The saturate matrix complements (1−SR etc.) from the CSS spec.
    expect(FRAGMENT_SHADER).toContain('0.787');
    expect(FRAGMENT_SHADER).toContain('0.285');
    expect(FRAGMENT_SHADER).toContain('0.928');
  });

  it('every tuning constant appears verbatim', () => {
    expect(FRAGMENT_SHADER).toContain(`exp2(u_exposure * ${EXPOSURE_EV_RANGE.toFixed(1)})`);
    for (const c of [
      WB_TEMP_SCALE,
      WB_TINT_SCALE,
      TONE_SCALE,
      TONE_POINT_SCALE,
      VIBRANCE_SCALE,
      VIGNETTE_INNER,
      VIGNETTE_SCALE,
    ]) {
      expect(FRAGMENT_SHADER).toContain(String(c));
    }
  });

  it('float literals never degrade to GLSL ints (no bare "2)" style scalars)', () => {
    // The one integer-looking constant is EXPOSURE_EV_RANGE = 2 → must be 2.0
    expect(FRAGMENT_SHADER).not.toMatch(/u_exposure \* 2\)/);
  });

  it('detail constants appear verbatim in the composite', () => {
    for (const c of [NR_EDGE_LO, NR_EDGE_HI, CLARITY_SCALE, SHARPEN_SCALE]) {
      expect(FRAGMENT_SHADER).toContain(String(c));
    }
    expect(FRAGMENT_SHADER).toContain('u_detail');
    // Dither is present at the output write.
    expect(FRAGMENT_SHADER).toContain('12.9898');
    expect(FRAGMENT_SHADER).toContain('/ 255.0');
  });

  it('blur fragments bake their exact gaussian kernels', () => {
    for (const [source, sigma, taps] of [
      [BLUR_SMALL_FRAGMENT, BLUR_SMALL_SIGMA, BLUR_SMALL_TAPS],
      [BLUR_LARGE_FRAGMENT, BLUR_LARGE_SIGMA, BLUR_LARGE_TAPS],
    ] as const) {
      expect(source.startsWith('#version 300 es')).toBe(true);
      for (const weight of gaussianKernel(sigma, taps)) {
        expect(source).toContain(String(weight));
      }
      expect(source).toContain('u_direction');
    }
    expect(COPY_FRAGMENT.startsWith('#version 300 es')).toBe(true);
  });

  it('composite carries the HSL mixer stage with its constants', () => {
    expect(FRAGMENT_SHADER).toContain('u_hslLut');
    expect(FRAGMENT_SHADER).toContain('u_hslEnabled');
    expect(FRAGMENT_SHADER).toContain('rgb2hsl');
    expect(FRAGMENT_SHADER).toContain('hsl2rgb');
    for (const c of [HSL_HUE_RANGE_DEG, HSL_SAT_RANGE, HSL_LUM_RANGE, HSL_GRAY_GUARD]) {
      expect(FRAGMENT_SHADER).toContain(String(c));
    }
    // Symmetric-zero LUT decode (byte 128 → exactly 0).
    expect(FRAGMENT_SHADER).toContain('- 128.0) / 127.5');
  });

  it('composite carries the tone-curve LUT stage', () => {
    expect(FRAGMENT_SHADER).toContain('u_curveLut');
    expect(FRAGMENT_SHADER).toContain('u_curveEnabled');
  });

  it('warp fragment embeds the perspective scale and border-black rule', () => {
    expect(WARP_FRAGMENT.startsWith('#version 300 es')).toBe(true);
    expect(WARP_FRAGMENT).toContain(String(PERSPECTIVE_SCALE));
    expect(WARP_FRAGMENT).toContain('u_persp');
    expect(WARP_FRAGMENT).toContain('vec4(0.0, 0.0, 0.0, 1.0)');
  });
});
