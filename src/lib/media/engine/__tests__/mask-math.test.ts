import { describe, it, expect } from 'vitest';
import {
  applyMaskDeltas,
  defaultLinearMask,
  defaultRadialMask,
  isNeutralMasks,
  maskBlurWeight,
  maskDeltas,
  maskWeight,
  MAX_MASKS,
  moveLinearEndpoint,
  moveMask,
  wantsBackgroundBlur,
} from '../mask-math';
import type { Mask } from '../../types';

function radial(overrides: Partial<Extract<Mask, { kind: 'radial' }>> = {}): Mask {
  return { ...defaultRadialMask(), ...overrides } as Mask;
}

function linear(overrides: Partial<Extract<Mask, { kind: 'linear' }>> = {}): Mask {
  return { ...defaultLinearMask(), ...overrides } as Mask;
}

describe('maskWeight — radial', () => {
  it('is 1 at the center, 0 well outside, and feathers between', () => {
    const m = radial({ cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, feather: 0.5 });
    expect(maskWeight(m, 0.5, 0.5)).toBe(1);
    expect(maskWeight(m, 0.95, 0.5)).toBe(0); // d = 2.25 ellipse units
    const mid = maskWeight(m, 0.65, 0.5); // d = 0.75, inside the feather band
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('feather 0 is a hard-edged ellipse', () => {
    const m = radial({ rx: 0.2, ry: 0.2, feather: 0 });
    expect(maskWeight(m, 0.5 + 0.19, 0.5)).toBe(1);
    expect(maskWeight(m, 0.5 + 0.21, 0.5)).toBe(0);
  });

  it('invert flips inside and outside', () => {
    const m = radial({ rx: 0.2, ry: 0.2, invert: true });
    expect(maskWeight(m, 0.5, 0.5)).toBe(0);
    expect(maskWeight(m, 0.95, 0.5)).toBe(1);
  });

  it('ellipse axes are independent (rx vs ry)', () => {
    const m = radial({ rx: 0.4, ry: 0.1, feather: 0 });
    expect(maskWeight(m, 0.85, 0.5)).toBe(1); // 0.35/0.4 inside
    expect(maskWeight(m, 0.5, 0.65)).toBe(0); // 0.15/0.1 outside
  });
});

describe('maskWeight — linear', () => {
  it('is 1 at the start, 0 at the end, monotone along the gradient', () => {
    const m = linear({ x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.8 });
    expect(maskWeight(m, 0.5, 0.1)).toBe(1); // before start → full
    expect(maskWeight(m, 0.5, 0.2)).toBe(1);
    expect(maskWeight(m, 0.5, 0.5)).toBeCloseTo(0.5);
    expect(maskWeight(m, 0.5, 0.8)).toBe(0);
    expect(maskWeight(m, 0.5, 0.95)).toBe(0); // beyond end → none
  });

  it('is constant perpendicular to the gradient axis', () => {
    const m = linear({ x0: 0.5, y0: 0.2, x1: 0.5, y1: 0.8 });
    expect(maskWeight(m, 0.1, 0.5)).toBeCloseTo(maskWeight(m, 0.9, 0.5));
  });

  it('a degenerate (zero-length) gradient contributes nothing', () => {
    const m = linear({ x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 });
    expect(maskWeight(m, 0.3, 0.3)).toBe(0);
  });
});

describe('maskDeltas + applyMaskDeltas', () => {
  it('overlapping masks sum their weighted deltas', () => {
    const masks: Mask[] = [
      radial({ rx: 0.5, ry: 0.5, feather: 0, adjust: { exposure: 0.4, saturation: 0, temperature: 0 } }),
      radial({ rx: 0.5, ry: 0.5, feather: 0, adjust: { exposure: 0.2, saturation: 0, temperature: 0 } }),
    ];
    expect(maskDeltas(masks, 0.5, 0.5).ev).toBeCloseTo(0.6);
    expect(maskDeltas(masks, 0.99, 0.99).ev).toBe(0);
  });

  it('exposure +1 inside the mask doubles a midtone (±1 EV local range)', () => {
    const [r] = applyMaskDeltas([0.25, 0.25, 0.25], { ev: 1, saturation: 0, temperature: 0 });
    expect(r).toBeCloseTo(0.5);
  });

  it('saturation −1 grays the pixel; warmth shifts r up and b down', () => {
    const gray = applyMaskDeltas([0.8, 0.2, 0.2], { ev: 0, saturation: -1, temperature: 0 });
    expect(gray[0]).toBeCloseTo(gray[1], 5);
    expect(gray[1]).toBeCloseTo(gray[2], 5);
    const warm = applyMaskDeltas([0.5, 0.5, 0.5], { ev: 0, saturation: 0, temperature: 1 });
    expect(warm[0]).toBeCloseTo(0.6);
    expect(warm[2]).toBeCloseTo(0.4);
  });
});

describe('background blur (E4e)', () => {
  it('blur weight is mask weight × amount, clamped across overlaps', () => {
    const soft = radial({
      rx: 0.5,
      ry: 0.5,
      feather: 0,
      adjust: { exposure: 0, saturation: 0, temperature: 0, blur: 0.6 },
    });
    expect(maskBlurWeight([soft], 0.5, 0.5)).toBeCloseTo(0.6);
    expect(maskBlurWeight([soft], 0.99, 0.99)).toBe(0);
    expect(maskBlurWeight([soft, soft], 0.5, 0.5)).toBe(1); // 1.2 → clamped
  });

  it('a blur-only mask is NOT neutral, and plans the bg pass', () => {
    const blurOnly = radial({
      adjust: { exposure: 0, saturation: 0, temperature: 0, blur: 0.5 },
    });
    expect(isNeutralMasks([blurOnly])).toBe(false);
    expect(wantsBackgroundBlur([blurOnly])).toBe(true);
    expect(wantsBackgroundBlur([radial()])).toBe(false);
  });
});

describe('brush masks (E4f)', () => {
  it('maskWeight for a brush samples the provided buffer, 0 without one', () => {
    const brush: Mask = {
      kind: 'brush',
      strokes: [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.1, feather: 0 }],
      adjust: { exposure: 1, saturation: 0, temperature: 0 },
    };
    expect(maskWeight(brush, 0.5, 0.5)).toBe(0); // no buffer provided
    const buffer = new Float32Array(16 * 16).fill(0);
    buffer[8 * 16 + 8] = 1;
    const bb = { buffer, width: 16, height: 16 };
    expect(maskWeight(brush, (8 + 0.5) / 16, (8 + 0.5) / 16, bb)).toBeCloseTo(1);
    expect(maskWeight(brush, 0.05, 0.05, bb)).toBe(0);
  });

  it('maskDeltas threads brush buffers by index', () => {
    const brush: Mask = {
      kind: 'brush',
      strokes: [{ points: [{ x: 0.5, y: 0.5 }], radius: 0.1, feather: 0 }],
      adjust: { exposure: 0.5, saturation: 0, temperature: 0 },
    };
    const buffer = new Float32Array(8 * 8).fill(1);
    const deltas = maskDeltas([brush], 0.5, 0.5, [{ buffer, width: 8, height: 8 }]);
    expect(deltas.ev).toBeCloseTo(0.5);
    expect(maskDeltas([brush], 0.5, 0.5).ev).toBe(0); // no buffers → inert
  });

  it('moveMask translates a brush without smearing at the frame edge', () => {
    const brush: Mask = {
      kind: 'brush',
      strokes: [
        { points: [{ x: 0.8, y: 0.5 }, { x: 0.9, y: 0.5 }], radius: 0.05, feather: 0.5 },
      ],
      adjust: { exposure: 0, saturation: 0, temperature: 0 },
    };
    const moved = moveMask(brush, 0.3, 0) as Extract<Mask, { kind: 'brush' }>;
    // Delta clamped to 0.1 so the far point stops at 1 and spacing survives.
    expect(moved.strokes[0].points[1].x).toBeCloseTo(1);
    expect(moved.strokes[0].points[1].x - moved.strokes[0].points[0].x).toBeCloseTo(0.1);
  });
});

describe('neutrality + editing rules', () => {
  it('absent/empty/zero-adjust masks are neutral; any adjust is not', () => {
    expect(isNeutralMasks(undefined)).toBe(true);
    expect(isNeutralMasks([])).toBe(true);
    expect(isNeutralMasks([radial()])).toBe(true); // geometry alone = nothing
    expect(
      isNeutralMasks([radial({ adjust: { exposure: 0.1, saturation: 0, temperature: 0 } })])
    ).toBe(false);
    expect(MAX_MASKS).toBe(4);
  });

  it('moveMask translates and clamps; linear moves both endpoints together', () => {
    const moved = moveMask(radial({ cx: 0.9, cy: 0.5 }), 0.3, -0.2) as Extract<
      Mask,
      { kind: 'radial' }
    >;
    expect(moved.cx).toBe(1); // clamped
    expect(moved.cy).toBeCloseTo(0.3);
    const line = moveMask(linear({ x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }), 0.1, 0.1) as Extract<
      Mask,
      { kind: 'linear' }
    >;
    expect(line.x0).toBeCloseTo(0.3);
    expect(line.x1).toBeCloseTo(0.9);
  });

  it('moveLinearEndpoint moves one end only', () => {
    const base = linear({ x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 }) as Extract<
      Mask,
      { kind: 'linear' }
    >;
    const moved = moveLinearEndpoint(base, 1, 0.6, 0.4) as Extract<Mask, { kind: 'linear' }>;
    expect(moved.x0).toBe(0.2);
    expect(moved.x1).toBe(0.6);
    expect(moved.y1).toBe(0.4);
  });
});
