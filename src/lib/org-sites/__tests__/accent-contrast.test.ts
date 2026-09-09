import { describe, it, expect } from 'vitest';
import {
  APP_SURFACE_DARK,
  APP_SURFACE_LIGHT,
  contrastRatio,
  mixHex,
  readableOn,
  relativeLuminance,
} from '../accent-contrast';

describe('accent-contrast', () => {
  it('measures WCAG contrast (black on white is 21:1, a colour against itself 1:1)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#7c3aed', '#7c3aed')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBe(0);
  });

  it('mixes toward a target (t=0 is the input, t=1 is the target)', () => {
    expect(mixHex('#7c3aed', '#ffffff', 0)).toBe('#7c3aed');
    expect(mixHex('#7c3aed', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('returns the input untouched when it already reads on the surface', () => {
    // violet-700 on white is ~6.8:1 — the app's own light --brand-fg-strong.
    expect(readableOn('#6d28d9', APP_SURFACE_LIGHT)).toBe('#6d28d9');
  });

  it('derives a readable text tint for any validated accent, on BOTH app surfaces', () => {
    // Accents that pass the write-time fill rule (L ≤ 0.30) but fail as text
    // on one surface or the other: near-black, violet-600, a dark green, a
    // deep wine, the violet-500 default.
    for (const accent of ['#000000', '#7c3aed', '#1f4d2e', '#4c0519', '#8b5cf6', '#0f766e']) {
      const dark = readableOn(accent, APP_SURFACE_DARK)!;
      const light = readableOn(accent, APP_SURFACE_LIGHT)!;
      expect(dark).toMatch(/^#[0-9a-f]{6}$/);
      expect(light).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(dark, APP_SURFACE_DARK)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(light, APP_SURFACE_LIGHT)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('mixes toward white on the dark surface and toward black on the light one', () => {
    // #000000 on the dark surface must lighten; #ffffff on white must darken.
    expect(relativeLuminance(readableOn('#000000', APP_SURFACE_DARK)!)).toBeGreaterThan(0);
    expect(relativeLuminance(readableOn('#ffffff', APP_SURFACE_LIGHT)!)).toBeLessThan(1);
  });

  it('never throws on junk — non-hex input reads as null', () => {
    expect(readableOn('violet', APP_SURFACE_LIGHT)).toBeNull();
    expect(readableOn('#7c3aed', 'white')).toBeNull();
    // case-insensitive input, lower-case output
    expect(readableOn('#7C3AED', APP_SURFACE_LIGHT)).toBe(readableOn('#7c3aed', APP_SURFACE_LIGHT));
  });
});
