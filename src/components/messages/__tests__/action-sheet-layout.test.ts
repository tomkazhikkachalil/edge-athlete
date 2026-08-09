import { describe, it, expect } from 'vitest';
import {
  clampSheetTop,
  SHEET_GAP_PX,
  SHEET_VIEWPORT_MARGIN_PX,
} from '../action-sheet-layout';

describe('clampSheetTop', () => {
  const viewport = { viewportTop: 0, viewportHeight: 800 };

  it('lines the sheet up with the pressed bubble when everything fits', () => {
    const top = clampSheetTop({
      anchorTop: 400,
      emojiRowHeight: 52,
      panelHeight: 300,
      ...viewport,
    });
    expect(top).toBe(400 - 52 - SHEET_GAP_PX);
  });

  it('clamps to the bottom when the bubble sits low in the viewport', () => {
    const top = clampSheetTop({
      anchorTop: 760,
      emojiRowHeight: 52,
      panelHeight: 300,
      ...viewport,
    });
    expect(top).toBe(800 - 300 - SHEET_VIEWPORT_MARGIN_PX);
  });

  it('clamps to the top margin when the bubble is at the very top', () => {
    const top = clampSheetTop({
      anchorTop: 10,
      emojiRowHeight: 52,
      panelHeight: 300,
      ...viewport,
    });
    expect(top).toBe(SHEET_VIEWPORT_MARGIN_PX);
  });

  it('respects a keyboard-shrunk visual viewport (offsetTop > 0)', () => {
    // Keyboard up: visual viewport is the 300px band starting at y=100.
    const top = clampSheetTop({
      anchorTop: 120,
      emojiRowHeight: 52,
      panelHeight: 250,
      viewportTop: 100,
      viewportHeight: 300,
    });
    // Desired (60) is above the band → clamped to band top + margin.
    expect(top).toBe(100 + SHEET_VIEWPORT_MARGIN_PX);
  });

  it('pins an oversized panel to the top margin (its head must stay reachable)', () => {
    const top = clampSheetTop({
      anchorTop: 400,
      emojiRowHeight: 52,
      panelHeight: 900,
      ...viewport,
    });
    expect(top).toBe(SHEET_VIEWPORT_MARGIN_PX);
  });
});
