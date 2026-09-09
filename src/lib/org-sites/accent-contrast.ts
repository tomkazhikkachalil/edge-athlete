/**
 * Accent → readable text colour, per theme, with no new column (Org Pages
 * R2, Sep 8 2026). A site's accent is validated at write to be dark enough
 * as a FILL under white text (ACCENT_MAX_LUMINANCE in validate.ts), but that
 * says nothing about the accent as TEXT on the app's surfaces — violet-600
 * on the dark surface is ~2.9:1. The public site never has this problem
 * (light-only); the in-app page does. So the fill stays the manager's
 * colour and the text tint is DERIVED: mixed toward white on a dark surface
 * (or black on a light one) in 5% steps until it clears WCAG AA (4.5:1).
 *
 * Pure and dependency-free (client-safe); the app's surface hexes are
 * mirrored from globals.css `--surface` — keep them in sync.
 */

export const APP_SURFACE_LIGHT = '#ffffff';
/** globals.css [data-theme="dark"] --surface. */
export const APP_SURFACE_DARK = '#1f1a16';

const HEX_RE = /^#[0-9a-f]{6}$/i;

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map(c => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG relative luminance of #rrggbb (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = channels(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two #rrggbb colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear mix of `hex` toward `toward` by t ∈ [0, 1]. */
export function mixHex(hex: string, toward: string, t: number): string {
  const a = channels(hex);
  const b = channels(toward);
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
}

/**
 * The input if it already reads on `surface` at `min`; otherwise the first
 * 5%-step mix toward white (dark surface) or black (light surface) that
 * does. Terminates: white on the dark surface ≈ 15.9:1, black on white 21:1.
 * Non-hex input returns null (never throws — brand payloads are best-effort).
 */
export function readableOn(hex: string, surface: string, min = 4.5): string | null {
  if (!HEX_RE.test(hex) || !HEX_RE.test(surface)) return null;
  const lower = hex.toLowerCase();
  if (contrastRatio(lower, surface) >= min) return lower;
  const toward = relativeLuminance(surface) < 0.5 ? '#ffffff' : '#000000';
  for (let step = 1; step <= 20; step++) {
    const candidate = mixHex(lower, toward, step * 0.05);
    if (contrastRatio(candidate, surface) >= min) return candidate;
  }
  return toward;
}
