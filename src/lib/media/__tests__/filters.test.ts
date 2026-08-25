import { describe, it, expect } from 'vitest';
import {
  applyAdjustments,
  composeAdjustments,
  cssFilterString,
  isNeutral,
  NEUTRAL_ADJUSTMENTS,
  PRESET_FILTERS,
} from '../filters';

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);

describe('cssFilterString', () => {
  it('is empty when neutral (GPU skip)', () => {
    expect(cssFilterString(NEUTRAL_ADJUSTMENTS)).toBe('');
  });

  it('emits the brightness→contrast→saturate order the pixel path implements', () => {
    expect(cssFilterString({ brightness: 1.2, contrast: 0.9, saturation: 1.5 })).toBe(
      'brightness(1.2) contrast(0.9) saturate(1.5)'
    );
  });
});

describe('applyAdjustments', () => {
  it('neutral is a true no-op', () => {
    const data = px(10, 128, 250);
    applyAdjustments(data, NEUTRAL_ADJUSTMENTS);
    expect([...data]).toEqual([10, 128, 250, 255]);
  });

  it('brightness multiplies channels and clamps', () => {
    const data = px(100, 200, 0);
    applyAdjustments(data, { brightness: 1.5, contrast: 1, saturation: 1 });
    expect(data[0]).toBe(150);
    expect(data[1]).toBe(255); // 300 clamped
    expect(data[2]).toBe(0);
  });

  it('contrast pivots around 127.5 (CSS formula)', () => {
    const data = px(127, 128, 27);
    applyAdjustments(data, { brightness: 1, contrast: 2, saturation: 1 });
    // (127-127.5)*2+127.5 = 126.5 → 126 or 127 after rounding
    expect(Math.abs(data[0] - 126.5)).toBeLessThanOrEqual(0.5);
    // (27-127.5)*2+127.5 = -73.5 → clamped 0
    expect(data[2]).toBe(0);
  });

  it('saturation 0 produces the Rec.601 luma gray', () => {
    const data = px(255, 0, 0);
    applyAdjustments(data, { brightness: 1, contrast: 1, saturation: 0 });
    // 0.213*255 ≈ 54 on every channel
    expect(Math.abs(data[0] - 54)).toBeLessThanOrEqual(1);
    expect(data[0]).toBe(data[1]);
    expect(data[1]).toBe(data[2]);
  });

  it('saturation 1 leaves color untouched; alpha never changes', () => {
    const data = px(12, 200, 90, 42);
    applyAdjustments(data, { brightness: 1, contrast: 1, saturation: 1 });
    expect([...data]).toEqual([12, 200, 90, 42]);
  });

  it('gray pixels are saturation-invariant', () => {
    const data = px(80, 80, 80);
    applyAdjustments(data, { brightness: 1, contrast: 1, saturation: 1.8 });
    expect(Math.abs(data[0] - 80)).toBeLessThanOrEqual(1);
    expect(Math.abs(data[1] - 80)).toBeLessThanOrEqual(1);
    expect(Math.abs(data[2] - 80)).toBeLessThanOrEqual(1);
  });
});

describe('presets', () => {
  it('every preset stays within the schema range 0–2', () => {
    for (const p of PRESET_FILTERS) {
      for (const v of Object.values(p.adjustments)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(2);
      }
    }
  });

  it('composeAdjustments multiplies with the preset; null passes through', () => {
    const user = { brightness: 1.1, contrast: 1, saturation: 0.9 };
    expect(composeAdjustments(user, null)).toEqual(user);
    const mono = composeAdjustments(user, 'mono');
    expect(mono.saturation).toBe(0); // 0.9 × 0
    expect(isNeutral(mono)).toBe(false);
  });

  it('unknown preset id is ignored', () => {
    expect(composeAdjustments(NEUTRAL_ADJUSTMENTS, 'nope')).toEqual(NEUTRAL_ADJUSTMENTS);
  });

  it('film-pack engine components stay within each field’s schema range', () => {
    for (const p of PRESET_FILTERS) {
      for (const v of Object.values(p.light ?? {})) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
      }
      for (const v of Object.values(p.color ?? {})) {
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
      }
      const { vignette, ...unsignedDetail } = p.detail ?? {};
      for (const v of Object.values(unsignedDetail)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      if (vignette !== undefined) expect(Math.abs(vignette)).toBeLessThanOrEqual(1);
    }
  });

  it('preset ids are unique (getPreset resolves by first match)', () => {
    const ids = PRESET_FILTERS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
