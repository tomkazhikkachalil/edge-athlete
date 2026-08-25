import { describe, it, expect } from 'vitest';
import {
  defaultEmojiOverlay,
  defaultTextOverlay,
  isNeutralOverlays,
  MAX_OVERLAYS,
  OVERLAY_COLOR_REGEX,
  OVERLAY_COLORS,
  OVERLAY_EMOJI,
  overlayFontLoadSpecs,
  overlayFontPx,
  overlayFontString,
  PILL_PAD_X,
  PILL_PAD_Y,
  pillRect,
} from '../overlay-layout';
import type { Overlay } from '../../types';

const text = (overrides: Partial<Extract<Overlay, { kind: 'text' }>> = {}): Overlay => ({
  ...(defaultTextOverlay() as Extract<Overlay, { kind: 'text' }>),
  ...overrides,
});

describe('font strings (the DOM↔canvas contract)', () => {
  it('builds weight + px + our bundled family with a fallback stack', () => {
    expect(overlayFontString(text({ size: 0.1, fontId: 'inter' }), 2000)).toBe(
      '600 200px EAInter, sans-serif'
    );
    expect(overlayFontString(text({ size: 0.05, fontId: 'lora' }), 1000)).toBe(
      '500 50px EALora, sans-serif'
    );
    expect(overlayFontString(text({ fontId: 'caveat', size: 0.08 }), 1000)).toContain('EACaveat');
  });

  it('emoji ride the system face at the same pixel size', () => {
    expect(overlayFontString(defaultEmojiOverlay(), 1000)).toBe('120px sans-serif');
  });

  it('font px scales with image width and never collapses to 0', () => {
    expect(overlayFontPx(0.1, 512)).toBeCloseTo(51.2);
    expect(overlayFontPx(0.02, 10)).toBeGreaterThanOrEqual(1);
  });
});

describe('pill metrics', () => {
  it('pads the measured width and centers on the origin', () => {
    const rect = pillRect(300, 100);
    expect(rect.width).toBeCloseTo(300 + 2 * PILL_PAD_X * 100);
    expect(rect.height).toBeCloseTo(100 * (1 + 2 * PILL_PAD_Y));
    expect(rect.x).toBeCloseTo(-rect.width / 2);
    expect(rect.y).toBeCloseTo(-rect.height / 2);
    expect(rect.radius).toBeLessThanOrEqual(rect.height / 2);
  });
});

describe('font preloading specs', () => {
  it('one spec per distinct face, none for emoji-only overlays', () => {
    const specs = overlayFontLoadSpecs([
      text({ fontId: 'inter' }),
      text({ fontId: 'inter' }),
      text({ fontId: 'caveat' }),
      defaultEmojiOverlay(),
    ]);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toContain('EAInter');
    expect(specs[1]).toContain('EACaveat');
    expect(overlayFontLoadSpecs([defaultEmojiOverlay()])).toEqual([]);
  });
});

describe('defaults + constants', () => {
  it('defaults validate against the palette/regex and stay centered-ish', () => {
    const t = defaultTextOverlay() as Extract<Overlay, { kind: 'text' }>;
    expect(OVERLAY_COLOR_REGEX.test(t.color)).toBe(true);
    expect(OVERLAY_COLORS).toContain(t.color as (typeof OVERLAY_COLORS)[number]);
    expect(t.x).toBe(0.5);
    const e = defaultEmojiOverlay() as Extract<Overlay, { kind: 'emoji' }>;
    expect(OVERLAY_EMOJI).toContain(e.emoji as (typeof OVERLAY_EMOJI)[number]);
  });

  it('neutrality: absent/empty only', () => {
    expect(isNeutralOverlays(undefined)).toBe(true);
    expect(isNeutralOverlays([])).toBe(true);
    expect(isNeutralOverlays([defaultTextOverlay()])).toBe(false);
    expect(MAX_OVERLAYS).toBe(8);
  });
});
