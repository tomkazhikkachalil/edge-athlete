/**
 * Text/sticker overlay layout math (Phase 2, round E4h) — PURE,
 * node-tested. The DOM preview and the canvas export both consume THESE
 * functions (font strings, pixel sizes, pill metrics), so the two can
 * only diverge by the platform's glyph rasterizer — the fonts themselves
 * are bundled, identical everywhere.
 */

import type { Overlay, OverlayFontId } from '../types';

export const MAX_OVERLAYS = 8;

/** CSS family names owned by globals.css @font-face (bundled OFL woff2). */
export const OVERLAY_FONT_FAMILIES: Record<OverlayFontId, string> = {
  inter: 'EAInter',
  lora: 'EALora',
  caveat: 'EACaveat',
};

export const OVERLAY_FONT_WEIGHTS: Record<OverlayFontId, number> = {
  inter: 600,
  lora: 500,
  caveat: 700,
};

export const OVERLAY_FONT_LABELS: Record<OverlayFontId, string> = {
  inter: 'Clean',
  lora: 'Serif',
  caveat: 'Script',
};

/** Swatch palette (plus the color regex the schema enforces). */
export const OVERLAY_COLORS = [
  '#ffffff',
  '#0a0a0a',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#a855f7',
] as const;

export const OVERLAY_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;

/** Pill backdrop metrics, relative to the font size. */
export const PILL_PAD_X = 0.5; // × fontPx each side
export const PILL_PAD_Y = 0.28;
export const PILL_RADIUS = 0.45;
export const PILL_FILL = 'rgba(0, 0, 0, 0.55)';

/** Curated sticker grid (sport-flavored) — free entry allows any emoji. */
export const OVERLAY_EMOJI = [
  '🔥',
  '💪',
  '🏆',
  '🥇',
  '🎯',
  '⚽',
  '🏀',
  '⛳',
  '🏒',
  '🏊',
  '🎾',
  '🏋️',
  '😤',
  '😅',
  '🙌',
  '❄️',
] as const;

export function isNeutralOverlays(overlays: Overlay[] | undefined | null): boolean {
  return !overlays || overlays.length === 0;
}

export function defaultTextOverlay(): Overlay {
  return {
    kind: 'text',
    content: 'Your text',
    x: 0.5,
    y: 0.5,
    size: 0.08,
    fontId: 'inter',
    color: '#ffffff',
    rotation: 0,
  };
}

export function defaultEmojiOverlay(): Overlay {
  return { kind: 'emoji', emoji: '🔥', x: 0.5, y: 0.3, size: 0.12, rotation: 0 };
}

/** Font size in device pixels for an image of `imageWidth` px. */
export function overlayFontPx(size: number, imageWidth: number): number {
  return Math.max(1, size * imageWidth);
}

/** The exact CSS font string both renderers use. Emoji ride the system
 *  emoji font at the same size (color emoji aren't in our bundled faces —
 *  and every platform renders its own emoji everywhere else in the app
 *  too, so this matches user expectations). */
export function overlayFontString(overlay: Overlay, imageWidth: number): string {
  const px = overlayFontPx(overlay.size, imageWidth);
  if (overlay.kind === 'emoji') return `${px}px sans-serif`;
  const family = OVERLAY_FONT_FAMILIES[overlay.fontId];
  const weight = OVERLAY_FONT_WEIGHTS[overlay.fontId];
  return `${weight} ${px}px ${family}, sans-serif`;
}

/** Pill rect around a measured text width, centered on the overlay. */
export function pillRect(
  textWidthPx: number,
  fontPx: number
): { x: number; y: number; width: number; height: number; radius: number } {
  const width = textWidthPx + 2 * PILL_PAD_X * fontPx;
  const height = fontPx * (1 + 2 * PILL_PAD_Y);
  return {
    x: -width / 2,
    y: -height / 2,
    width,
    height,
    radius: Math.min(PILL_RADIUS * fontPx, height / 2),
  };
}

/** The `document.fonts.load` specs that must resolve before an export
 *  rasterizes text (font-display swap would silently substitute). */
export function overlayFontLoadSpecs(overlays: Overlay[]): string[] {
  const specs = new Set<string>();
  for (const overlay of overlays) {
    if (overlay.kind !== 'text') continue;
    specs.add(
      `${OVERLAY_FONT_WEIGHTS[overlay.fontId]} 32px ${OVERLAY_FONT_FAMILIES[overlay.fontId]}`
    );
  }
  return [...specs];
}
