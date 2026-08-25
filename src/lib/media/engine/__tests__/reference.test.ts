import { describe, it, expect } from 'vitest';
import { applyEngine } from '../reference';
import { NEUTRAL_ENGINE_PARAMS, type EngineParams } from '../params';
import { applyAdjustments, NEUTRAL_COLOR, NEUTRAL_DETAIL, NEUTRAL_LIGHT } from '../../filters';

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
