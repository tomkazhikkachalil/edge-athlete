/**
 * Canvas rendering of text/sticker overlays (browser-only, thin — the
 * layout math lives in engine/overlay-layout.ts and is node-tested).
 * Deliberately NOT part of the WebGL engine: glyph rasterization is a 2D
 * canvas job. Runs as the export's LAST stage, over grain and vignette.
 */

import {
  overlayFontLoadSpecs,
  overlayFontPx,
  overlayFontString,
  PILL_FILL,
  pillRect,
} from './engine/overlay-layout';
import type { Overlay } from './types';

/** Resolve the bundled faces before rasterizing — font-display: swap would
 *  otherwise silently substitute a fallback into the EXPORT. Never throws
 *  (a load failure degrades to the fallback stack, which is still text). */
export async function ensureOverlayFontsLoaded(overlays: Overlay[]): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  try {
    await Promise.all(overlayFontLoadSpecs(overlays).map(spec => document.fonts.load(spec)));
  } catch {
    // Degrade to fallback faces rather than blocking the export.
  }
}

/** Draw overlays onto a rendered image canvas (width/height = canvas px). */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlays: Overlay[]
): void {
  for (const overlay of overlays) {
    ctx.save();
    ctx.translate(overlay.x * width, overlay.y * height);
    ctx.rotate((overlay.rotation * Math.PI) / 180);
    ctx.font = overlayFontString(overlay, width);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (overlay.kind === 'text') {
      if (overlay.pill) {
        const fontPx = overlayFontPx(overlay.size, width);
        const metrics = ctx.measureText(overlay.content);
        const rect = pillRect(metrics.width, fontPx);
        ctx.fillStyle = PILL_FILL;
        ctx.beginPath();
        ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius);
        ctx.fill();
      }
      ctx.fillStyle = overlay.color;
      ctx.fillText(overlay.content, 0, 0);
    } else {
      ctx.fillText(overlay.emoji, 0, 0);
    }
    ctx.restore();
  }
}
