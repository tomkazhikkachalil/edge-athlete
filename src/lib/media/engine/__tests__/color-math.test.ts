import { describe, it, expect } from 'vitest';
import {
  applyExposure,
  applyLegacy,
  applyTone,
  applyVibrance,
  applyVignette,
  applyWhiteBalance,
  clamp01,
  luma709,
  smoothstep,
  transformPixel,
  vignetteFalloff,
  type Rgb,
} from '../color-math';
import { NEUTRAL_ADJUSTMENTS, NEUTRAL_COLOR, NEUTRAL_LIGHT } from '../../filters';

const closeTo = (actual: Rgb, expected: Rgb, digits = 6) => {
  expect(actual[0]).toBeCloseTo(expected[0], digits);
  expect(actual[1]).toBeCloseTo(expected[1], digits);
  expect(actual[2]).toBeCloseTo(expected[2], digits);
};

describe('helpers', () => {
  it('smoothstep matches GLSL semantics', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(0.5, 1, 0.75)).toBeCloseTo(0.5);
  });

  it('clamp01 clamps', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
  });

  it('luma709 uses Rec. 709 weights', () => {
    expect(luma709(1, 1, 1)).toBeCloseTo(1);
    expect(luma709(1, 0, 0)).toBeCloseTo(0.2126);
    expect(luma709(0, 1, 0)).toBeCloseTo(0.7152);
    expect(luma709(0, 0, 1)).toBeCloseTo(0.0722);
  });
});

describe('legacy trio (CSS byte-parity contract)', () => {
  it('neutral is the identity', () => {
    closeTo(applyLegacy([0.25, 0.5, 0.75], NEUTRAL_ADJUSTMENTS), [0.25, 0.5, 0.75]);
  });

  it('brightness multiplies, contrast pivots at 0.5', () => {
    closeTo(
      applyLegacy([0.25, 0.25, 0.25], { brightness: 2, contrast: 1, saturation: 1 }),
      [0.5, 0.5, 0.5]
    );
    closeTo(
      applyLegacy([0.25, 0.25, 0.25], { brightness: 1, contrast: 2, saturation: 1 }),
      [0, 0, 0]
    );
  });

  it('saturation 0 grayscales through the Rec. 601 CSS matrix', () => {
    const [r, g, b] = applyLegacy([1, 0.5, 0], { brightness: 1, contrast: 1, saturation: 0 });
    const expected = 0.213 * 1 + 0.715 * 0.5 + 0.072 * 0;
    expect(r).toBeCloseTo(expected);
    expect(g).toBeCloseTo(expected);
    expect(b).toBeCloseTo(expected);
  });
});

describe('exposure', () => {
  it('slider ±1 spans ±2 EV', () => {
    closeTo(applyExposure([0.2, 0.2, 0.2], 1), [0.8, 0.8, 0.8]); // 2 EV = ×4
    closeTo(applyExposure([0.4, 0.4, 0.4], -0.5), [0.2, 0.2, 0.2]); // −1 EV = ×0.5
    closeTo(applyExposure([0.3, 0.3, 0.3], 0), [0.3, 0.3, 0.3]);
  });
});

describe('white balance', () => {
  it('temperature swings red up and blue down, multiplicatively', () => {
    closeTo(applyWhiteBalance([0.5, 0.5, 0.5], 1, 0), [0.6, 0.5, 0.4]);
    closeTo(applyWhiteBalance([0.5, 0.5, 0.5], -1, 0), [0.4, 0.5, 0.6]);
  });

  it('tint + is magenta (green down)', () => {
    closeTo(applyWhiteBalance([0.5, 0.5, 0.5], 0, 1), [0.5, 0.425, 0.5]);
  });
});

describe('tone', () => {
  it('neutral is the identity', () => {
    closeTo(applyTone([0.3, 0.6, 0.1], NEUTRAL_LIGHT), [0.3, 0.6, 0.1]);
  });

  it('highlight recovery cannot move pure white (mask vanishes at the endpoint)', () => {
    closeTo(applyTone([1, 1, 1], { ...NEUTRAL_LIGHT, highlights: -1 }), [1, 1, 1]);
  });

  it('shadow lift fades to zero at pure black', () => {
    closeTo(applyTone([0, 0, 0], { ...NEUTRAL_LIGHT, shadows: 1 }), [0, 0, 0]);
  });

  it('whites −1 pulls pure white down by the endpoint scale', () => {
    closeTo(applyTone([1, 1, 1], { ...NEUTRAL_LIGHT, whites: -1 }), [0.75, 0.75, 0.75]);
  });

  it('blacks +1 lifts pure black achromatically (film-fade black point)', () => {
    closeTo(applyTone([0, 0, 0], { ...NEUTRAL_LIGHT, blacks: 1 }), [0.25, 0.25, 0.25]);
  });

  it('shadows +1 lifts a quarter-gray by the masked ratio', () => {
    // L=0.25: mask (1−ss(0,0.5,0.25))=0.5, shape L(1−L)·2=0.375 →
    // dHS = 0.3·0.5·0.375 = 0.05625; ratio = 1 + 0.05625/0.25 = 1.225
    closeTo(applyTone([0.25, 0.25, 0.25], { ...NEUTRAL_LIGHT, shadows: 1 }), [
      0.30625, 0.30625, 0.30625,
    ]);
  });
});

describe('vibrance', () => {
  it('leaves grays and fully-saturated colors alone', () => {
    closeTo(applyVibrance([0.4, 0.4, 0.4], 1), [0.4, 0.4, 0.4]);
    closeTo(applyVibrance([1, 0, 0], 1), [1, 0, 0]);
  });

  it('boosts low-saturation colors most', () => {
    // sat = 0.25 → amount = 1 + 0.6·0.75 = 1.45 around L = 0.30315
    const [r, g, b] = applyVibrance([0.5, 0.25, 0.25], 1);
    expect(r).toBeCloseTo(0.5885825);
    expect(g).toBeCloseTo(0.2260825);
    expect(b).toBeCloseTo(0.2260825);
  });
});

describe('vignette', () => {
  it('falloff is 0 at center, 1 at the corners', () => {
    expect(vignetteFalloff(0.5, 0.5, 200, 100)).toBe(0);
    expect(vignetteFalloff(0, 0, 200, 100)).toBeCloseTo(1);
    expect(vignetteFalloff(1, 1, 200, 100)).toBeCloseTo(1);
  });

  it('positive darkens, negative lightens toward white', () => {
    closeTo(applyVignette([0.5, 0.5, 0.5], 1, 1), [0.1, 0.1, 0.1]); // ×(1−0.8)
    closeTo(applyVignette([0.5, 0.5, 0.5], -1, 1), [0.9, 0.9, 0.9]); // +0.8·(1−0.5)
    closeTo(applyVignette([0.5, 0.5, 0.5], 1, 0), [0.5, 0.5, 0.5]); // center untouched
  });
});

describe('transformPixel', () => {
  it('neutral params are the identity (clamped)', () => {
    closeTo(
      transformPixel([0.2, 0.5, 0.9], {
        adjustments: NEUTRAL_ADJUSTMENTS,
        light: NEUTRAL_LIGHT,
        color: NEUTRAL_COLOR,
        vignette: 0,
      }, 0),
      [0.2, 0.5, 0.9]
    );
  });

  it('clamps once at the end, not between stages', () => {
    // Exposure pushes above 1; whites −1 then pulls back below — surviving
    // detail proves the intermediate wasn't clamped.
    const out = transformPixel([0.6, 0.6, 0.6], {
      adjustments: NEUTRAL_ADJUSTMENTS,
      light: { ...NEUTRAL_LIGHT, exposure: 1, whites: -1 },
      color: NEUTRAL_COLOR,
      vignette: 0,
    }, 0);
    // 0.6·4 = 2.4 → L clamps to 1 for masking → dWB = −0.25 → 2.15 → clamp 1
    closeTo(out, [1, 1, 1]);
    const outLower = transformPixel([0.15, 0.15, 0.15], {
      adjustments: NEUTRAL_ADJUSTMENTS,
      light: { ...NEUTRAL_LIGHT, exposure: 1, whites: -1 },
      color: NEUTRAL_COLOR,
      vignette: 0,
    }, 0);
    // 0.15·4 = 0.6 (< 0.65 white-mask edge) → whites does nothing → 0.6
    closeTo(outLower, [0.6, 0.6, 0.6]);
  });
});
