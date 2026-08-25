import { describe, it, expect } from 'vitest';
import {
  applyHslLut,
  bakeHslLut,
  HSL_BAND_CENTERS,
  HSL_BAND_NAMES,
  HSL_LUT_SIZE,
  hslAdjustAtHue,
  hslToRgb,
  isNeutralHsl,
  neutralHslMix,
  normalizeHslMix,
  rgbToHsl,
} from '../hsl-math';
import type { HslMix } from '../../types';

function mixWith(band: (typeof HSL_BAND_NAMES)[number], adjust: Partial<HslMix[typeof band]>): HslMix {
  const mix = neutralHslMix();
  mix[band] = { ...mix[band], ...adjust };
  return mix;
}

describe('color space', () => {
  it('round-trips representative colors within float noise', () => {
    for (const [r, g, b] of [
      [1, 0, 0],
      [0.2, 0.7, 0.4],
      [0.9, 0.9, 0.1],
      [0.05, 0.1, 0.8],
    ] as const) {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [nr, ng, nb] = hslToRgb(h, s, l);
      expect(nr).toBeCloseTo(r, 4);
      expect(ng).toBeCloseTo(g, 4);
      expect(nb).toBeCloseTo(b, 4);
    }
  });

  it('grays have zero saturation and survive the round trip', () => {
    const [h, s, l] = rgbToHsl(0.42, 0.42, 0.42);
    expect(s).toBe(0);
    expect(h).toBe(0);
    const [r, g, b] = hslToRgb(h, s, l);
    expect(r).toBeCloseTo(0.42, 5);
    expect(g).toBeCloseTo(0.42, 5);
    expect(b).toBeCloseTo(0.42, 5);
  });
});

describe('band aggregation', () => {
  it('a band center returns exactly that band’s values', () => {
    const mix = mixWith('green', { saturation: -0.8 });
    const atGreen = hslAdjustAtHue(HSL_BAND_CENTERS[3], mix); // green = 120°
    expect(atGreen.saturation).toBeCloseTo(-0.8);
    const atBlue = hslAdjustAtHue(HSL_BAND_CENTERS[5], mix); // blue untouched
    expect(atBlue.saturation).toBe(0);
  });

  it('midway between adjacent centers blends 50/50 (smoothstep midpoint)', () => {
    const mix = mixWith('red', { hue: 1 });
    // red 0° → orange 30°; midpoint 15° → smoothstep(0.5) = 0.5
    expect(hslAdjustAtHue(15, mix).hue).toBeCloseTo(0.5);
  });

  it('is continuous across the red wrap (magenta 320° → red 360°)', () => {
    const mix = mixWith('red', { luminance: 1 });
    const justBelow = hslAdjustAtHue(359.9, mix).luminance;
    const justAbove = hslAdjustAtHue(0.1, mix).luminance;
    expect(Math.abs(justBelow - justAbove)).toBeLessThan(0.01);
    expect(justBelow).toBeGreaterThan(0.95); // effectively full red value
  });
});

describe('bakeHslLut', () => {
  it('neutral mix bakes a TRUE identity (every byte exactly 128)', () => {
    const lut = bakeHslLut(neutralHslMix());
    expect(lut).toHaveLength(HSL_LUT_SIZE * 4);
    for (let i = 0; i < lut.length; i += 4) {
      expect(lut[i]).toBe(128);
      expect(lut[i + 1]).toBe(128);
      expect(lut[i + 2]).toBe(128);
      expect(lut[i + 3]).toBe(255);
    }
  });

  it('a red desaturate shows up in the red bins and not the aqua bins', () => {
    const lut = bakeHslLut(mixWith('red', { saturation: -1 }));
    expect(lut[0 * 4 + 1]).toBeLessThan(20); // bin 0 = red center, near −1
    const aquaBin = Math.round((180 / 360) * HSL_LUT_SIZE);
    expect(lut[aquaBin * 4 + 1]).toBe(128); // aqua untouched
  });
});

describe('applyHslLut', () => {
  it('neutral LUT is the identity within a byte step', () => {
    const lut = bakeHslLut(neutralHslMix());
    const [r, g, b] = applyHslLut([0.8, 0.3, 0.2], lut);
    expect(r).toBeCloseTo(0.8, 2);
    expect(g).toBeCloseTo(0.3, 2);
    expect(b).toBeCloseTo(0.2, 2);
  });

  it('grays are fully protected by the gray guard', () => {
    const lut = bakeHslLut(mixWith('red', { hue: 1, saturation: 1, luminance: 1 }));
    expect(applyHslLut([0.5, 0.5, 0.5], lut)).toEqual([0.5, 0.5, 0.5]);
  });

  it('red saturation −1 pulls a pure red toward gray', () => {
    const lut = bakeHslLut(mixWith('red', { saturation: -1 }));
    const [r, g, b] = applyHslLut([1, 0, 0], lut);
    expect(r).toBeLessThan(0.85); // desaturated…
    expect(g).toBeGreaterThan(0.1); // …channels converge
    expect(Math.abs(g - b)).toBeLessThan(0.02);
  });

  it('red luminance −1 darkens a red without touching an aqua', () => {
    const lut = bakeHslLut(mixWith('red', { luminance: -1 }));
    const [r] = applyHslLut([1, 0, 0], lut);
    expect(r).toBeLessThan(0.75);
    const aqua = applyHslLut([0, 0.8, 0.8], lut);
    expect(aqua[1]).toBeCloseTo(0.8, 2);
  });

  it('red hue +1 rotates red toward orange (green channel rises)', () => {
    const lut = bakeHslLut(mixWith('red', { hue: 1 }));
    const [, g] = applyHslLut([1, 0, 0], lut);
    expect(g).toBeGreaterThan(0.3); // +45° of a pure red ≈ orange
  });
});

describe('neutrality + normalization', () => {
  it('absent, empty, and zeroed mixes are neutral; any value is not', () => {
    expect(isNeutralHsl(undefined)).toBe(true);
    expect(isNeutralHsl({})).toBe(true);
    expect(isNeutralHsl({ blue: { hue: 0, saturation: 0, luminance: 0 } })).toBe(true);
    expect(isNeutralHsl({ blue: { hue: 0, saturation: 0.1, luminance: 0 } })).toBe(false);
  });

  it('normalizeHslMix fills every band with zeros around a sparse recipe', () => {
    const full = normalizeHslMix({ aqua: { hue: 0, saturation: 0, luminance: -0.5 } });
    expect(Object.keys(full)).toHaveLength(8);
    expect(full.aqua.luminance).toBe(-0.5);
    expect(full.red).toEqual({ hue: 0, saturation: 0, luminance: 0 });
  });
});
