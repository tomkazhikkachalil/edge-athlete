import { describe, it, expect } from 'vitest';
import {
  applyCloneStamps,
  cloneWeight,
  defaultCloneStamp,
  isNeutralClones,
  MAX_CLONE_STAMPS,
  moveStampPoint,
} from '../clone-math';
import type { CloneStamp } from '../../types';

const stamp = (overrides: Partial<CloneStamp> = {}): CloneStamp => ({
  srcX: 0.7,
  srcY: 0.5,
  dstX: 0.3,
  dstY: 0.5,
  radius: 0.1,
  feather: 0.5,
  ...overrides,
});

describe('cloneWeight', () => {
  it('is 1 at the destination center, 0 outside the circle', () => {
    const s = stamp({ feather: 0 });
    expect(cloneWeight(s, 0.3, 0.5, 100, 100)).toBe(1);
    expect(cloneWeight(s, 0.3 + 0.09, 0.5, 100, 100)).toBe(1); // inside
    expect(cloneWeight(s, 0.3 + 0.11, 0.5, 100, 100)).toBe(0); // outside
  });

  it('feathers between the shrunk core and the edge', () => {
    const s = stamp({ feather: 1 });
    const mid = cloneWeight(s, 0.3 + 0.05, 0.5, 100, 100);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('circles are aspect-corrected (round on non-square frames)', () => {
    // Radius 0.1 of WIDTH on a 200×100 frame: vertically that's 0.2 in v.
    const s = stamp({ feather: 0 });
    expect(cloneWeight(s, 0.3, 0.5 + 0.18, 200, 100)).toBe(1); // 0.18 < 0.2
    expect(cloneWeight(s, 0.3, 0.5 + 0.22, 200, 100)).toBe(0);
  });
});

describe('applyCloneStamps', () => {
  it('copies the source region over the destination, spares the outside', () => {
    // 32×32: left half black, right half white. Stamp copies from the
    // white right (0.75) over the black left (0.25).
    const w = 32;
    const h = 32;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = x < w / 2 ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    applyCloneStamps(data, w, h, [
      stamp({ srcX: 0.75, srcY: 0.5, dstX: 0.25, dstY: 0.5, radius: 0.12, feather: 0 }),
    ]);
    expect(data[(16 * w + 8) * 4]).toBe(255); // healed center of dst
    expect(data[(2 * w + 2) * 4]).toBe(0); // far corner untouched
    expect(data[(16 * w + 24) * 4]).toBe(255); // source side unchanged
  });

  it('all stamps sample the ORIGINAL pixels (no cascading heals)', () => {
    // Stamp A heals region R from white. Stamp B then copies FROM R —
    // it must get R's ORIGINAL (black) pixels, not A's healed white.
    const w = 32;
    const h = 32;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const v = x < w / 2 ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    applyCloneStamps(data, w, h, [
      stamp({ srcX: 0.75, srcY: 0.25, dstX: 0.25, dstY: 0.25, radius: 0.1, feather: 0 }),
      // B: dst bottom-left, src = A's healed region (0.25, 0.25).
      stamp({ srcX: 0.25, srcY: 0.25, dstX: 0.25, dstY: 0.75, radius: 0.1, feather: 0 }),
    ]);
    expect(data[(8 * w + 8) * 4]).toBe(255); // A healed
    expect(data[(24 * w + 8) * 4]).toBe(0); // B copied the ORIGINAL black
  });

  it('feather blends toward the copied pixels at the rim', () => {
    const w = 24;
    const h = 24;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = 255;
    }
    // Make the source region white.
    for (let y = 0; y < h; y++) {
      for (let x = 16; x < 24; x++) {
        const i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 255;
      }
    }
    applyCloneStamps(data, w, h, [
      stamp({ srcX: 0.85, srcY: 0.5, dstX: 0.3, dstY: 0.5, radius: 0.15, feather: 1 }),
    ]);
    const center = data[(12 * w + 7) * 4];
    const rim = data[(12 * w + 10) * 4];
    expect(center).toBeGreaterThan(200);
    expect(rim).toBeGreaterThan(0);
    expect(rim).toBeLessThan(center);
  });
});

describe('editing rules + neutrality', () => {
  it('defaultCloneStamp offsets the source and clamps at the frame edge', () => {
    const s = defaultCloneStamp(0.95, 0.5);
    expect(s.dstX).toBeCloseTo(0.95);
    expect(s.srcX).toBe(1); // 0.95 + 0.15 clamped
  });

  it('moveStampPoint moves one handle only, clamped', () => {
    const moved = moveStampPoint(stamp(), 'src', 1.2, -0.1);
    expect(moved.srcX).toBe(1);
    expect(moved.srcY).toBe(0);
    expect(moved.dstX).toBeCloseTo(0.3); // untouched
  });

  it('absent/empty stamp lists are neutral; any stamp is an edit', () => {
    expect(isNeutralClones(undefined)).toBe(true);
    expect(isNeutralClones([])).toBe(true);
    expect(isNeutralClones([stamp()])).toBe(false);
    expect(MAX_CLONE_STAMPS).toBe(8);
  });
});
