import { describe, it, expect } from 'vitest';
import { clamp01, uploadingLine, weightedProgress } from '../upload-progress';

describe('weightedProgress', () => {
  it('weights by bytes — the 40 MB video decides, the 2 KB poster barely moves it', () => {
    expect(weightedProgress([{ bytes: 40_000_000, fraction: 0.5 }, { bytes: 2_000, fraction: 0 }])).toBeCloseTo(0.49997, 4);
    expect(weightedProgress([{ bytes: 10, fraction: 1 }, { bytes: 30, fraction: 0 }])).toBe(0.25);
  });
  it('is 0 with nothing to send and never leaves 0..1', () => {
    expect(weightedProgress([])).toBe(0);
    expect(weightedProgress([{ bytes: 0, fraction: 1 }])).toBe(0);
    expect(weightedProgress([{ bytes: 5, fraction: 7 }])).toBe(1);
    expect(clamp01(NaN)).toBe(0);
    expect(clamp01(-1)).toBe(0);
  });
});

describe('uploadingLine', () => {
  it('names the item in flight and its own percent', () => {
    expect(uploadingLine([1, 0.45, undefined])).toBe('Uploading 2 of 3 · 45%');
    expect(uploadingLine([undefined])).toBe('Uploading · 0%');
    expect(uploadingLine([0.999])).toBe('Uploading · 100%');
  });
  it('is null with nothing uploading or everything sent', () => {
    expect(uploadingLine([])).toBeNull();
    expect(uploadingLine([1, 1])).toBeNull();
  });
});
