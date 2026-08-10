import { describe, it, expect } from 'vitest';
import { placePanel } from '../panel-placement';

const desktop = { viewportTop: 0, viewportHeight: 800, layoutViewportHeight: 800 };

describe('placePanel', () => {
  it('desktop, room above: anchors bottom to the anchor top (parity with pre-keyboard math)', () => {
    const p = placePanel({
      anchorTop: 500, anchorBottom: 540, anchorLeft: 100, anchorWidth: 300,
      panelH: 200, gap: 2, ...desktop,
    });
    expect(p.bottom).toBe(800 - 500 + 2);
    expect(p.top).toBeUndefined();
    expect(p.left).toBe(100);
    expect(p.width).toBe(300);
  });

  it('desktop, near the top: flips below', () => {
    const p = placePanel({
      anchorTop: 80, anchorBottom: 120, anchorLeft: 0, anchorWidth: 390,
      panelH: 200, gap: 2, ...desktop,
    });
    expect(p.top).toBe(120 + 2);
    expect(p.bottom).toBeUndefined();
  });

  it('iOS keyboard pan (the modal case): raw coords, room judged vs the visible strip', () => {
    // Keyboard up inside the scroll-locked modal: visual viewport is the
    // 370px strip starting at layout y=300; the composer sits at y=560 —
    // visually low in the strip but with a big rect.top.
    const p = placePanel({
      anchorTop: 560, anchorBottom: 600, anchorLeft: 20, anchorWidth: 350,
      panelH: 200, gap: 2,
      viewportTop: 300, viewportHeight: 370, layoutViewportHeight: 844,
    });
    // roomAbove = 560-300 = 260 ≥ 206 → above, RAW coordinates (no +offset).
    expect(p.bottom).toBe(844 - 560 + 2);
    // The panel's top edge (560-2-200=358) stays inside the strip [300,670].
    expect(560 - 2 - 200).toBeGreaterThanOrEqual(300);
  });

  it('iOS keyboard pan, composer near the strip top: flips below despite a large rect.top', () => {
    const p = placePanel({
      anchorTop: 340, anchorBottom: 380, anchorLeft: 20, anchorWidth: 350,
      panelH: 200, gap: 2,
      viewportTop: 300, viewportHeight: 370, layoutViewportHeight: 844,
    });
    // roomAbove = 40 < 206 → below. The old math (top >= panelH) would have
    // opened above, off the visible strip.
    expect(p.top).toBe(380 + 2);
  });

  it('maxHeightCap shrinks to the visible strip and drives the flip', () => {
    const p = placePanel({
      anchorTop: 500, anchorBottom: 540, anchorLeft: 0, anchorWidth: 390,
      panelH: 288, gap: 2,
      viewportTop: 300, viewportHeight: 240, layoutViewportHeight: 844,
      maxHeightCap: 288,
    });
    expect(p.maxHeight).toBe(240 - 4 - 8);
    // roomAbove = 200 < effectiveH(228)+6 → below.
    expect(p.top).toBe(542);
  });

  it('maxHeight never collapses below the floor', () => {
    const p = placePanel({
      anchorTop: 200, anchorBottom: 240, anchorLeft: 0, anchorWidth: 390,
      panelH: 288, gap: 2,
      viewportTop: 0, viewportHeight: 80, layoutViewportHeight: 844,
      maxHeightCap: 288,
    });
    expect(p.maxHeight).toBe(96);
  });
});
