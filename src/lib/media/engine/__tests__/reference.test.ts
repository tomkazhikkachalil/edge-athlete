import { describe, it, expect } from 'vitest';
import { applyEngine, resampleBilinear, separableBlur } from '../reference';
import { NEUTRAL_ENGINE_PARAMS, type EngineParams } from '../params';
import { applyAdjustments, NEUTRAL_COLOR, NEUTRAL_DETAIL, NEUTRAL_LIGHT } from '../../filters';
import { gaussianKernel } from '../color-math';

/** Deterministic RGBA test strip: every byte value appears across channels. */
function testPixels(count = 256): Uint8ClampedArray {
  const data = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    data[i * 4] = i % 256;
    data[i * 4 + 1] = (i * 7 + 31) % 256;
    data[i * 4 + 2] = (255 - i) % 256;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function params(overrides: Partial<EngineParams>): EngineParams {
  return {
    adjustments: { ...NEUTRAL_ENGINE_PARAMS.adjustments },
    light: { ...NEUTRAL_LIGHT },
    color: { ...NEUTRAL_COLOR },
    detail: { ...NEUTRAL_DETAIL },
    ...overrides,
  };
}

describe('reference engine — identity and legacy parity', () => {
  it('neutral params leave every byte untouched', () => {
    const data = testPixels();
    const before = Array.from(data);
    applyEngine(data, 256, 1, params({}));
    expect(Array.from(data)).toEqual(before);
  });

  it('legacy-trio-only params byte-match applyAdjustments within ±1 (the v2 parity contract)', () => {
    const adjustments = { brightness: 1.2, contrast: 0.85, saturation: 1.4 };
    const viaEngine = testPixels();
    const viaLegacy = testPixels();
    applyEngine(viaEngine, 256, 1, params({ adjustments }));
    applyAdjustments(viaLegacy, adjustments);
    let maxDiff = 0;
    for (let i = 0; i < viaEngine.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs(viaEngine[i] - viaLegacy[i]));
    }
    expect(maxDiff).toBeLessThanOrEqual(1);
  });

  it('alpha is never modified', () => {
    const data = testPixels();
    applyEngine(data, 256, 1, params({ light: { ...NEUTRAL_LIGHT, exposure: 0.8 } }));
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });
});

describe('reference engine — engine-round stages', () => {
  it('exposure +0.5 (1 EV) doubles a mid tone', () => {
    const data = new Uint8ClampedArray([64, 64, 64, 255]);
    applyEngine(data, 1, 1, params({ light: { ...NEUTRAL_LIGHT, exposure: 0.5 } }));
    expect(data[0]).toBe(128);
    expect(data[1]).toBe(128);
    expect(data[2]).toBe(128);
  });

  it('warm temperature raises red and lowers blue', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 255]);
    applyEngine(data, 1, 1, params({ color: { ...NEUTRAL_COLOR, temperature: 1 } }));
    expect(data[0]).toBe(120);
    expect(data[1]).toBe(100);
    expect(data[2]).toBe(80);
  });

  it('vignette darkens corners but not the center', () => {
    // 3×3 image, all mid-gray; max positive vignette.
    const data = new Uint8ClampedArray(9 * 4).fill(128);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    applyEngine(data, 3, 3, params({ detail: { ...NEUTRAL_DETAIL, vignette: 1 } }));
    const center = data[(1 * 3 + 1) * 4];
    const corner = data[0];
    expect(corner).toBeLessThan(center);
    expect(center).toBe(128); // pixel center at exactly (0.5, 0.5) → falloff 0
  });

  it('blacks +1 lifts pure black to the film-fade floor', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 255]);
    applyEngine(data, 1, 1, params({ light: { ...NEUTRAL_LIGHT, blacks: 1 } }));
    expect(data[0]).toBe(64); // 0.25 · 255 = 63.75 → rounds to 64
  });
});

describe('reference engine — blur building blocks (detail round)', () => {
  it('separable blur of an impulse reproduces the outer product of the kernel', () => {
    // 9×9 gray field, impulse at center.
    const w = 9;
    const src = new Float32Array(w * w * 3);
    src[(4 * w + 4) * 3] = 1; // red impulse
    const out = separableBlur(src, w, w, 1, 5);
    const k = gaussianKernel(1, 5);
    // Center = k0², one step right = k0·k1, diagonal = k1².
    expect(out[(4 * w + 4) * 3]).toBeCloseTo(k[0] * k[0], 6);
    expect(out[(4 * w + 5) * 3]).toBeCloseTo(k[0] * k[1], 6);
    expect(out[(5 * w + 5) * 3]).toBeCloseTo(k[1] * k[1], 6);
    // Beyond the kernel radius: exactly zero.
    expect(out[(4 * w + 8) * 3]).toBe(0);
  });

  it('blur and resample preserve flat fields exactly (DC preservation)', () => {
    const w = 8;
    const flat = new Float32Array(w * w * 3).fill(0.42);
    const blurred = separableBlur(flat, w, w, 2, 9);
    for (let i = 0; i < blurred.length; i++) expect(blurred[i]).toBeCloseTo(0.42, 6);
    const down = resampleBilinear(flat, w, w, 4, 4);
    for (let i = 0; i < down.length; i++) expect(down[i]).toBeCloseTo(0.42, 6);
  });

  it('resampleBilinear half-down of an even grid is the exact 2×2 box average', () => {
    // 2×2 → 1×1: destination center samples the exact midpoint of all four.
    const src = new Float32Array([0, 0, 0, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    const out = resampleBilinear(src, 2, 2, 1, 1);
    expect(out[0]).toBeCloseTo((0 + 1 + 0.5 + 0.5) / 4, 6);
  });

  it('sharpen widens a soft edge (contrast across it increases)', () => {
    // 16-wide two-level strip: 0.3 | 0.7 with the seam mid-image.
    const w = 16;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = x < w / 2 ? 77 : 179; // 0.3 / 0.7
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    applyEngine(data, w, h, params({ detail: { ...NEUTRAL_DETAIL, sharpen: 1 } }));
    const darkSide = data[(1 * w + 7) * 4]; // last pixel before the seam
    const brightSide = data[(1 * w + 8) * 4]; // first pixel after
    expect(darkSide).toBeLessThan(77); // undershoot
    expect(brightSide).toBeGreaterThan(179); // overshoot
  });

  it('noise reduction flattens checkerboard noise but leaves a hard edge alone', () => {
    // Left half: ±4-level checkerboard around 128. Right half: solid 230.
    // Wide enough that the probe pixels sit OUTSIDE the large blur's reach
    // of the seam (σ=2 at half-res ≈ 8px full-res) — near the seam the blur
    // base is contaminated by the other side and NR rightly backs off.
    const w = 32;
    const h = 16;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = x < w / 2 ? ((x + y) % 2 ? 132 : 124) : 230;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    applyEngine(data, w, h, params({ detail: { ...NEUTRAL_DETAIL, noiseReduction: 1 } }));
    // Noise amplitude deep in the left interior collapses toward the mean…
    const a = data[(8 * w + 4) * 4];
    const b = data[(8 * w + 5) * 4];
    expect(Math.abs(a - b)).toBeLessThan(3);
    // …while the solid right interior keeps its level.
    expect(data[(8 * w + 27) * 4]).toBeGreaterThan(225);
  });
});
