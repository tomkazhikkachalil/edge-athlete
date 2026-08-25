import { describe, it, expect } from 'vitest';
import { labelForKeys } from '../history-labels';

describe('labelForKeys', () => {
  it('null is the oldest retained state', () => {
    expect(labelForKeys(null)).toBe('Original');
  });

  it('labels every per-control slider key', () => {
    expect(labelForKeys('light.exposure')).toBe('Exposure');
    expect(labelForKeys('adjustments.contrast')).toBe('Contrast');
    expect(labelForKeys('color.vibrance')).toBe('Vibrance');
    expect(labelForKeys('detail.noiseReduction')).toBe('Noise reduction');
    expect(labelForKeys('detail.vignette')).toBe('Vignette');
  });

  it('labels object-patch key sets and one-taps', () => {
    expect(labelForKeys('crop')).toBe('Crop');
    expect(labelForKeys('aspect,crop')).toBe('Crop ratio');
    expect(labelForKeys('rotate')).toBe('Rotate');
    expect(labelForKeys('filterId')).toBe('Filter');
    expect(labelForKeys('filterStrength')).toBe('Filter intensity');
    expect(labelForKeys('auto')).toBe('Auto enhance');
    expect(labelForKeys('reset.light')).toBe('Reset light');
    expect(labelForKeys('clips')).toBe('Clips');
  });

  it('degrades unknown keys to a generic label, never throws', () => {
    expect(labelForKeys('future.tool')).toBe('Edit');
    expect(labelForKeys('')).toBe('Edit');
  });
});
