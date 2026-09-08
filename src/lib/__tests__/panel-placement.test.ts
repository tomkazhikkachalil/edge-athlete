import { describe, it, expect } from 'vitest';
import { placePanel, placeMenu } from '../panel-placement';

const desktop = { viewportTop: 0, viewportHeight: 800 };

describe('placePanel', () => {
  it('desktop, room above: anchors bottom to the anchor top (parity with pre-keyboard math)', () => {
    const p = placePanel({
      anchorTop: 500, anchorBottom: 540, anchorLeft: 100, anchorWidth: 300,
      panelH: 200, gap: 2, ...desktop,
    });
    // Top-anchored: panel bottom = anchorTop - gap, exactly.
    expect(p.top).toBe(500 - 2 - 200);
    expect(p.top + 200 + 2).toBe(500);
    expect(p.left).toBe(100);
    expect(p.width).toBe(300);
  });

  it('desktop, near the top: flips below', () => {
    const p = placePanel({
      anchorTop: 80, anchorBottom: 120, anchorLeft: 0, anchorWidth: 390,
      panelH: 200, gap: 2, ...desktop,
    });
    expect(p.top).toBe(120 + 2);
  });

  it('iOS keyboard pan (the modal case): raw coords, room judged vs the visible strip', () => {
    // Keyboard up inside the scroll-locked modal: visual viewport is the
    // 370px strip starting at layout y=300; the composer sits at y=560 —
    // visually low in the strip but with a big rect.top.
    const p = placePanel({
      anchorTop: 560, anchorBottom: 600, anchorLeft: 20, anchorWidth: 350,
      panelH: 200, gap: 2,
      viewportTop: 300, viewportHeight: 370,
    });
    // roomAbove = 560-300 = 260 ≥ 206 → above, RAW coordinates (no +offset).
    expect(p.top).toBe(560 - 2 - 200);
    // The panel's top edge stays inside the strip [300, 670].
    expect(p.top).toBeGreaterThanOrEqual(300);
  });

  it('iOS keyboard pan, composer near the strip top: flips below despite a large rect.top', () => {
    const p = placePanel({
      anchorTop: 340, anchorBottom: 380, anchorLeft: 20, anchorWidth: 350,
      panelH: 200, gap: 2,
      viewportTop: 300, viewportHeight: 370,
    });
    // roomAbove = 40 < 206 → below. The old math (top >= panelH) would have
    // opened above, off the visible strip.
    expect(p.top).toBe(380 + 2);
  });

  it('maxHeightCap shrinks to the visible strip and drives the flip', () => {
    const p = placePanel({
      anchorTop: 500, anchorBottom: 540, anchorLeft: 0, anchorWidth: 390,
      panelH: 288, gap: 2,
      viewportTop: 300, viewportHeight: 240,
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
      viewportTop: 0, viewportHeight: 80,
      maxHeightCap: 288,
    });
    expect(p.maxHeight).toBe(96);
  });
});

describe('placeMenu', () => {
  const phone = { viewportTop: 0, viewportHeight: 844, viewportWidth: 390, margin: 8 };

  it('opens below the trigger, right-aligned to it', () => {
    const m = placeMenu({ anchorTop: 100, anchorBottom: 144, anchorRight: 360, panelW: 200, panelH: 140, gap: 4, ...phone });
    expect(m.top).toBe(144 + 4);
    expect(m.left).toBe(360 - 200);
  });

  it('flips above when the visible strip has no room below', () => {
    const m = placeMenu({ anchorTop: 760, anchorBottom: 804, anchorRight: 360, panelW: 200, panelH: 140, gap: 4, ...phone });
    expect(m.top).toBe(760 - 4 - 140);
    expect(m.top + 140 + 4).toBe(760);
  });

  it('keyboard-shrunk strip: flips against the visible strip, not the layout viewport', () => {
    // Layout viewport still 844 tall, but the visible strip is the top 400px.
    const m = placeMenu({ anchorTop: 300, anchorBottom: 344, anchorRight: 360, panelW: 200, panelH: 140, gap: 4, ...phone, viewportHeight: 400 });
    expect(m.top).toBe(300 - 4 - 140);
  });

  it('clamps horizontally inside the margin on both sides', () => {
    // Trigger near the LEFT edge: right-aligning would push the panel off-screen left.
    const left = placeMenu({ anchorTop: 100, anchorBottom: 144, anchorRight: 60, panelW: 200, panelH: 140, gap: 4, ...phone });
    expect(left.left).toBe(8);
    // Trigger past the RIGHT edge (over-wide anchor): clamp to the right margin.
    const right = placeMenu({ anchorTop: 100, anchorBottom: 144, anchorRight: 700, panelW: 200, panelH: 140, gap: 4, ...phone });
    expect(right.left).toBe(390 - 8 - 200);
  });

  it('never rises above the visible strip when flipping a tall panel', () => {
    const m = placeMenu({ anchorTop: 700, anchorBottom: 744, anchorRight: 360, panelW: 200, panelH: 900, gap: 4, ...phone });
    expect(m.top).toBe(8);
  });
});
