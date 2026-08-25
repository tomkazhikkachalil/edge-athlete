import { describe, it, expect } from 'vitest';
import {
  dataMaskBuffer,
  decodeMaskRle,
  encodeMaskRle,
  featherMaskBuffer,
} from '../mask-rle';
import type { Mask } from '../../types';

/** A 16×16 buffer with a filled 6..10 square. */
function squareBuffer(): Float32Array {
  const buf = new Float32Array(16 * 16);
  for (let y = 6; y < 10; y++) for (let x = 6; x < 10; x++) buf[y * 16 + x] = 1;
  return buf;
}

const dataMask = (overrides: Partial<Extract<Mask, { kind: 'data' }>> = {}): Extract<
  Mask,
  { kind: 'data' }
> => ({
  kind: 'data',
  width: 16,
  height: 16,
  rle: encodeMaskRle(squareBuffer()),
  feather: 0,
  invert: false,
  adjust: { exposure: 0, saturation: 0, temperature: 0 },
  ...overrides,
});

describe('RLE codec', () => {
  it('round-trips a shape exactly', () => {
    const buf = squareBuffer();
    const decoded = decodeMaskRle(encodeMaskRle(buf), 16, 16)!;
    expect(Array.from(decoded)).toEqual(Array.from(buf));
  });

  it('round-trips the all-zero and all-one edge cases', () => {
    const zeros = new Float32Array(64);
    expect(Array.from(decodeMaskRle(encodeMaskRle(zeros), 8, 8)!)).toEqual(Array.from(zeros));
    const ones = new Float32Array(64).fill(1);
    const rle = encodeMaskRle(ones);
    expect(rle.startsWith('0,')).toBe(true); // zero-run-first convention
    expect(Array.from(decodeMaskRle(rle, 8, 8)!)).toEqual(Array.from(ones));
  });

  it('rejects malformed input: wrong total, overflow, garbage, negatives', () => {
    expect(decodeMaskRle('10,10', 8, 8)).toBeNull(); // 20 ≠ 64
    expect(decodeMaskRle('100', 8, 8)).toBeNull(); // overflow
    expect(decodeMaskRle('abc,4', 8, 8)).toBeNull();
    expect(decodeMaskRle('-4,68', 8, 8)).toBeNull();
    expect(decodeMaskRle('', 8, 8)).toBeNull();
    expect(decodeMaskRle('3.5,60.5', 8, 8)).toBeNull(); // non-integers
  });

  it('thresholds soft inputs at 0.5 on encode', () => {
    const soft = new Float32Array([0.2, 0.6, 0.4, 0.9]);
    expect(Array.from(decodeMaskRle(encodeMaskRle(soft), 2, 2)!)).toEqual([0, 1, 0, 1]);
  });
});

describe('featherMaskBuffer', () => {
  it('feather 0 returns the buffer untouched (same reference)', () => {
    const buf = squareBuffer();
    expect(featherMaskBuffer(buf, 16, 16, 0)).toBe(buf);
  });

  it('softens the edge while keeping the deep interior near 1', () => {
    // Fixture sized against the kernel footprint (the E1b lesson): a
    // 16px square on a 32² buffer so the center sits well clear of the
    // σ≈2 feather reach.
    const big = new Float32Array(32 * 32);
    for (let y = 8; y < 24; y++) for (let x = 8; x < 24; x++) big[y * 32 + x] = 1;
    const soft = featherMaskBuffer(big, 32, 32, 0.5);
    expect(soft[16 * 32 + 16]).toBeGreaterThan(0.95); // deep interior survives
    const edge = soft[16 * 32 + 25]; // just outside the hard square
    expect(edge).toBeGreaterThan(0.02); // spilled softly outward
    expect(edge).toBeLessThan(0.6);
    expect(soft[0]).toBeLessThan(0.01); // far corner still empty
  });
});

describe('dataMaskBuffer', () => {
  it('decodes, feathers, and inverts into a sampleable coverage buffer', () => {
    const plain = dataMaskBuffer(dataMask())!;
    expect(plain.width).toBe(16);
    expect(plain.buffer[8 * 16 + 8]).toBe(1);
    expect(plain.buffer[0]).toBe(0);
    const inverted = dataMaskBuffer(dataMask({ invert: true }))!;
    expect(inverted.buffer[8 * 16 + 8]).toBe(0);
    expect(inverted.buffer[0]).toBe(1);
  });

  it('malformed RLE degrades to null (zero weight downstream)', () => {
    expect(dataMaskBuffer(dataMask({ rle: '1,2,3' }))).toBeNull();
  });
});
