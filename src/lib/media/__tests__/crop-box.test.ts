import { describe, it, expect } from 'vitest';
import {
  displayedAspect,
  dragCrop,
  frameBounds,
  fullCrop,
  insidePicture,
  isAxisAligned,
  normalizeCrop,
  ratioCrop,
  refitCrop,
  rotateCropQuarter,
  scaleCrop,
  shrinkToFit,
  type CropContext,
  type CropFrame,
} from '../crop-box';
import type { CropRect } from '../types';

const flat: CropFrame = { natural: { width: 1000, height: 800 }, rotate: 0, straighten: 0 };
const tilted: CropFrame = { natural: { width: 1000, height: 800 }, rotate: 0, straighten: 10 };
const free = (frame: CropFrame = flat): CropContext => ({ frame, aspect: null, minSize: 50 });
const locked = (aspect: number, frame: CropFrame = flat): CropContext => ({
  frame,
  aspect,
  minSize: 50,
});
const whole: CropRect = { x: 0, y: 0, width: 1000, height: 800 };

describe('frame', () => {
  it('a quarter turn swaps the frame and stays axis-aligned', () => {
    const turned = { ...flat, rotate: 90 };
    expect(frameBounds(turned).width).toBeCloseTo(800);
    expect(frameBounds(turned).height).toBeCloseTo(1000);
    expect(isAxisAligned(turned)).toBe(true);
    expect(isAxisAligned({ ...flat, rotate: 270 })).toBe(true);
    expect(isAxisAligned(tilted)).toBe(false);
    expect(displayedAspect(flat)).toBeCloseTo(1.25);
    expect(displayedAspect(turned)).toBeCloseTo(0.8);
  });

  it('the whole frame is on an unturned picture, and off a tilted one', () => {
    expect(insidePicture(fullCrop(flat), flat)).toBe(true);
    expect(insidePicture(fullCrop(tilted), tilted)).toBe(false);
  });
});

describe('dragCrop — a free box', () => {
  it('a corner moves both of its edges and nothing else', () => {
    const next = dragCrop(whole, 'se', -200, -100, whole, free());
    expect(next).toEqual({ x: 0, y: 0, width: 800, height: 700 });
    const other = dragCrop(whole, 'nw', 150, 60, whole, free());
    expect(other).toEqual({ x: 150, y: 60, width: 850, height: 740 });
  });

  it('an edge moves one side only — any shape is reachable', () => {
    const next = dragCrop(whole, 'e', -700, 999, whole, free());
    expect(next).toEqual({ x: 0, y: 0, width: 300, height: 800 });
    expect(next.width / next.height).not.toBeCloseTo(1000 / 800);
  });

  it('never leaves the frame and never inverts', () => {
    const start: CropRect = { x: 200, y: 200, width: 400, height: 300 };
    const out = dragCrop(start, 'se', 5000, 5000, start, free());
    expect(out).toEqual({ x: 200, y: 200, width: 800, height: 600 });
    const crossed = dragCrop(start, 'e', -5000, 0, start, free());
    expect(crossed.width).toBe(50); // the minimum, not a negative width
    expect(crossed.x).toBe(200);
    const pastTop = dragCrop(start, 'n', 0, 5000, start, free());
    expect(pastTop.height).toBe(50);
    expect(pastTop.y + pastTop.height).toBe(500); // the bottom edge held
  });

  it('a drag inside moves the box whole and stops at the frame', () => {
    const start: CropRect = { x: 100, y: 100, width: 400, height: 300 };
    expect(dragCrop(start, 'move', 50, -20, start, free())).toEqual({
      x: 150,
      y: 80,
      width: 400,
      height: 300,
    });
    expect(dragCrop(start, 'move', 9000, 9000, start, free())).toEqual({
      x: 600,
      y: 500,
      width: 400,
      height: 300,
    });
  });

  it('is measured from the start of the gesture, so it cannot drift', () => {
    const start: CropRect = { x: 100, y: 100, width: 400, height: 300 };
    const out = dragCrop(start, 'e', 2000, 0, start, free());
    const back = dragCrop(start, 'e', 10, 0, out, free());
    expect(back.width).toBe(410);
  });
});

describe('dragCrop — a locked ratio', () => {
  const square: CropRect = { x: 100, y: 100, width: 400, height: 400 };

  it('a corner keeps the ratio and the opposite corner', () => {
    const next = dragCrop(square, 'se', 100, 10, square, locked(1));
    expect(next.width).toBeCloseTo(500);
    expect(next.height).toBeCloseTo(500);
    expect(next.x).toBe(100);
    expect(next.y).toBe(100);
    const shrink = dragCrop(square, 'nw', 100, 0, square, locked(1));
    expect(shrink.width).toBeCloseTo(300);
    expect(shrink.x + shrink.width).toBeCloseTo(500);
    expect(shrink.y + shrink.height).toBeCloseTo(500);
  });

  it('an edge scales the box about the opposite edge, centred on the other axis', () => {
    const next = dragCrop(square, 'e', 100, 0, square, locked(1));
    expect(next.width).toBeCloseTo(500);
    expect(next.height).toBeCloseTo(500);
    expect(next.x).toBe(100);
    expect(next.y + next.height / 2).toBeCloseTo(300);
  });

  it('stops growing where the frame ends, still in ratio', () => {
    const next = dragCrop(square, 'se', 5000, 5000, square, locked(1));
    expect(next.width).toBeCloseTo(next.height);
    expect(next.y + next.height).toBeLessThanOrEqual(800 + 1e-6);
    expect(next.height).toBeCloseTo(700);
  });

  it('a box of another shape is brought to the ratio first', () => {
    const next = dragCrop(whole, 'se', 0, 0, whole, locked(1));
    expect(next.width).toBeCloseTo(800);
    expect(next.height).toBeCloseTo(800);
  });
});

describe('scaleCrop — two fingers', () => {
  const start: CropRect = { x: 300, y: 250, width: 400, height: 300 };

  it('scales about the centre and keeps the shape', () => {
    const next = scaleCrop(start, 0.5, start, free());
    expect(next).toEqual({ x: 400, y: 325, width: 200, height: 150 });
  });

  it('stops at the frame and at the minimum', () => {
    const big = scaleCrop(start, 50, start, free());
    expect(big.x).toBeGreaterThanOrEqual(0);
    expect(big.y).toBeGreaterThanOrEqual(0);
    expect(big.x + big.width).toBeLessThanOrEqual(1000 + 1e-6);
    expect(big.y + big.height).toBeLessThanOrEqual(800 + 1e-6);
    expect(big.width / big.height).toBeCloseTo(4 / 3);
    const small = scaleCrop(start, 0.0001, start, free());
    expect(small.height).toBeCloseTo(50);
    expect(small.width / small.height).toBeCloseTo(4 / 3);
    expect(scaleCrop(start, Number.NaN, start, free())).toEqual(start);
  });
});

describe('a tilted picture — the box stays on it', () => {
  it('shrinkToFit matches the closed form for a square at 45°', () => {
    const frame: CropFrame = { natural: { width: 600, height: 600 }, rotate: 0, straighten: 45 };
    const fitted = ratioCrop(frame, 1);
    // Largest axis-aligned square in a square turned θ: L / (cos θ + sin θ).
    // (Within the sub-pixel slack the on-the-picture test allows.)
    expect(Math.abs(fitted.width - 600 / Math.SQRT2)).toBeLessThan(1.5);
    expect(insidePicture(fitted, frame)).toBe(true);
  });

  it('refit gives an uncropped tilted photo the largest box of its own shape', () => {
    const fitted = refitCrop(null, tilted, null)!;
    expect(fitted).not.toBeNull();
    expect(fitted.width / fitted.height).toBeCloseTo(1.25, 3);
    expect(insidePicture(fitted, tilted)).toBe(true);
    // …and growing it at all leaves the picture: it is the largest.
    const centre = { x: fitted.x + fitted.width / 2, y: fitted.y + fitted.height / 2 };
    const grown = {
      x: centre.x - (fitted.width * 1.01) / 2,
      y: centre.y - (fitted.height * 1.01) / 2,
      width: fitted.width * 1.01,
      height: fitted.height * 1.01,
    };
    expect(insidePicture(grown, tilted)).toBe(false);
  });

  it('refit leaves an unturned, unlocked photo uncropped, and honours a lock', () => {
    expect(refitCrop(null, flat, null)).toBeNull();
    const square = refitCrop(null, flat, 1)!;
    expect(square).toEqual({ x: 100, y: 0, width: 800, height: 800 });
  });

  it('refit keeps a crop that still fits and shrinks one that does not', () => {
    const small: CropRect = { x: 500, y: 400, width: 100, height: 100 };
    expect(refitCrop(small, tilted, null)).toEqual(small);
    const bounds = frameBounds(tilted);
    const big: CropRect = { x: 0, y: 0, width: bounds.width, height: bounds.height };
    const shrunk = refitCrop(big, tilted, null)!;
    expect(shrunk.width).toBeLessThan(big.width);
    expect(insidePicture(shrunk, tilted)).toBe(true);
  });

  it('refit keeps a box on the same part of the picture as the frame grows round it', () => {
    // A small box at the picture's centre: straightening must not move it
    // off the centre, though the frame's top-left corner moved.
    const centred: CropRect = { x: 450, y: 350, width: 100, height: 100 };
    const there = refitCrop(centred, tilted, null, flat)!;
    const bounds = frameBounds(tilted);
    expect(there.x + there.width / 2).toBeCloseTo(bounds.width / 2);
    expect(there.y + there.height / 2).toBeCloseTo(bounds.height / 2);
    // …and back again lands where it started.
    expect(refitCrop(there, flat, null, tilted)).toEqual(centred);
  });

  it('a handle dragged past the tilted edge stops on it', () => {
    const start = refitCrop(null, tilted, null)!;
    const dragged = dragCrop(start, 'se', 4000, 4000, start, free(tilted));
    expect(insidePicture(dragged, tilted)).toBe(true);
    const moved = dragCrop(start, 'move', 4000, 0, start, free(tilted));
    expect(insidePicture(moved, tilted)).toBe(true);
  });

  it('a free box slides along the edge instead of sticking', () => {
    const start: CropRect = { x: 450, y: 420, width: 200, height: 100 };
    expect(insidePicture(start, tilted)).toBe(true);
    // Far right and a little down: the horizontal half is blocked by the
    // picture's edge, the vertical half is not — the box still moves down.
    const moved = dragCrop(start, 'move', 4000, 30, start, free(tilted));
    expect(insidePicture(moved, tilted)).toBe(true);
    expect(moved.x).toBeGreaterThan(start.x);
  });

  it('shrinkToFit recentres a box whose centre is off the picture', () => {
    const corner: CropRect = { x: 0, y: 0, width: 40, height: 40 };
    const fitted = shrinkToFit(corner, { ...tilted, straighten: 30 });
    expect(insidePicture(fitted, { ...tilted, straighten: 30 })).toBe(true);
    expect(fitted.width).toBeGreaterThan(0);
  });
});

describe('ratioCrop', () => {
  it('is the largest box of the ratio, centred', () => {
    expect(ratioCrop(flat, 1)).toEqual({ x: 100, y: 0, width: 800, height: 800 });
    const wide = ratioCrop(flat, 16 / 9);
    expect(wide.width).toBeCloseTo(1000);
    expect(wide.height).toBeCloseTo(562.5);
    expect(wide.y).toBeCloseTo(118.75);
  });

  it('stays on what was framed when a crop already exists', () => {
    const framed: CropRect = { x: 0, y: 0, width: 200, height: 200 };
    const square = ratioCrop(flat, 1, framed);
    expect(square.x).toBe(0); // as far left as the frame allows
    const right: CropRect = { x: 800, y: 300, width: 200, height: 200 };
    expect(ratioCrop(flat, 1, right).x).toBe(200);
  });
});

describe('rotateCropQuarter', () => {
  it('carries the box with the picture, and four turns come home', () => {
    const rect: CropRect = { x: 100, y: 50, width: 300, height: 200 };
    const once = rotateCropQuarter(rect, { width: 1000, height: 800 });
    // Top-left region of a 1000×800 picture ends up top-right of 800×1000.
    expect(once).toEqual({ x: 550, y: 100, width: 200, height: 300 });
    let current = rect;
    let size = { width: 1000, height: 800 };
    for (let i = 0; i < 4; i++) {
      current = rotateCropQuarter(current, size);
      size = { width: size.height, height: size.width };
    }
    expect(current).toEqual(rect);
  });
});

describe('normalizeCrop', () => {
  it('the whole unturned frame is not an edit', () => {
    expect(normalizeCrop(whole, flat)).toBeNull();
    expect(normalizeCrop({ x: 0.4, y: 0.2, width: 999.3, height: 799.6 }, flat)).toBeNull();
    const turned = { ...flat, rotate: 90 };
    expect(normalizeCrop(fullCrop(turned), turned)).toBeNull();
  });

  it('rounds to whole pixels inside the frame', () => {
    expect(normalizeCrop({ x: 10.2, y: 20.7, width: 300.6, height: 200.2 }, flat)).toEqual({
      x: 10,
      y: 21,
      width: 301,
      height: 200,
    });
    expect(normalizeCrop({ x: 990, y: 790, width: 500, height: 500 }, flat)).toEqual({
      x: 990,
      y: 790,
      width: 10,
      height: 10,
    });
  });

  it('a box that only moved keeps its size, wherever it lands', () => {
    for (const offset of [0.1, 0.4, 0.5, 0.6, 0.9]) {
      const stored = normalizeCrop({ x: 100 + offset, y: 50 + offset, width: 179, height: 144 }, flat)!;
      expect(stored.width).toBe(179);
      expect(stored.height).toBe(144);
    }
  });

  it('a tilted frame always stores its box — the wedges must not export', () => {
    const fitted = refitCrop(null, tilted, null)!;
    const stored = normalizeCrop(fitted, tilted)!;
    expect(stored).not.toBeNull();
    expect(insidePicture(stored, tilted)).toBe(true);
    expect(Number.isInteger(stored.x) && Number.isInteger(stored.width)).toBe(true);
  });
});
