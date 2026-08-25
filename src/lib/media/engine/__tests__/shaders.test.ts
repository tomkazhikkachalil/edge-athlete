import { describe, it, expect } from 'vitest';
import { FRAGMENT_SHADER, VERTEX_SHADER } from '../shaders';
import {
  EXPOSURE_EV_RANGE,
  LUMA_B,
  LUMA_G,
  LUMA_R,
  SAT_B,
  SAT_G,
  SAT_R,
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
});
