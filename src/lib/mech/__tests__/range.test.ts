import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rangeClamp, rangeFraction, rangeKeyStep, rangeOffset, rangeTravel, rangeValueAt } from '../range';

const FEET = { min: 1, max: 15, step: 1 };

describe("a range slider's numbers", () => {
  it('snaps to a step and stays inside the scale', () => {
    expect(rangeClamp(6.4, FEET)).toBe(6);
    expect(rangeClamp(6.5, FEET)).toBe(7);
    expect(rangeClamp(-3, FEET)).toBe(1);
    expect(rangeClamp(99, FEET)).toBe(15);
    expect(rangeClamp(NaN, FEET)).toBe(1);
    expect(rangeClamp(7, { min: 0, max: 10, step: 5 })).toBe(5);
  });

  it('places a value along the scale', () => {
    expect(rangeFraction(1, FEET)).toBe(0);
    expect(rangeFraction(15, FEET)).toBe(1);
    expect(rangeFraction(8, FEET)).toBe(0.5);
    expect(rangeFraction(3, { min: 3, max: 3, step: 1 })).toBe(0);
  });

  it('the key stays wholly inside its track', () => {
    expect(rangeTravel(226, 26)).toBe(200);
    expect(rangeTravel(10, 26)).toBe(0);
    expect(rangeTravel(NaN, 26)).toBe(0);
    expect(rangeOffset(1, FEET, 200)).toBe(0);
    expect(rangeOffset(15, FEET, 200)).toBe(200);
    expect(rangeOffset(8, FEET, 200)).toBe(100);
  });

  it('reads the value under the pointer, the key centred on it', () => {
    // A 226 px track, a 26 px key: 200 px of travel, 14 steps.
    expect(rangeValueAt(0, 26, 200, FEET)).toBe(1);
    expect(rangeValueAt(13, 26, 200, FEET)).toBe(1);
    expect(rangeValueAt(113, 26, 200, FEET)).toBe(8);
    expect(rangeValueAt(213, 26, 200, FEET)).toBe(15);
    expect(rangeValueAt(900, 26, 200, FEET)).toBe(15);
    expect(rangeValueAt(-50, 26, 200, FEET)).toBe(1);
    expect(rangeValueAt(100, 26, 0, FEET)).toBe(1);
  });

  it('every value can be reached by a drag', () => {
    const seen = new Set<number>();
    for (let x = 0; x <= 226; x += 1) seen.add(rangeValueAt(x, 26, 200, FEET));
    expect([...seen].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  it('keys: arrows step, Page keys jump, Home and End go to the ends; other keys are not ours', () => {
    expect(rangeKeyStep('ArrowRight', 6, FEET)).toBe(7);
    expect(rangeKeyStep('ArrowUp', 6, FEET)).toBe(7);
    expect(rangeKeyStep('ArrowLeft', 6, FEET)).toBe(5);
    expect(rangeKeyStep('ArrowDown', 6, FEET)).toBe(5);
    expect(rangeKeyStep('ArrowRight', 15, FEET)).toBe(15);
    expect(rangeKeyStep('ArrowLeft', 1, FEET)).toBe(1);
    expect(rangeKeyStep('PageUp', 6, FEET)).toBe(11);
    expect(rangeKeyStep('PageDown', 6, FEET)).toBe(1);
    expect(rangeKeyStep('Home', 6, FEET)).toBe(1);
    expect(rangeKeyStep('End', 6, FEET)).toBe(15);
    expect(rangeKeyStep('Enter', 6, FEET)).toBeNull();
    expect(rangeKeyStep('Tab', 6, FEET)).toBeNull();
  });

  it('is pure: the module imports nothing', () => {
    expect(readFileSync(join(process.cwd(), 'src/lib/mech/range.ts'), 'utf8')).not.toMatch(/^import /m);
  });
});
