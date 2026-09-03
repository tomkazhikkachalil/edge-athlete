import { describe, it, expect } from 'vitest';
import { exifHonoured, ORIENTATION_PROBE_JPEG_BASE64, ORIENTATION_PROBE_STORED } from '../orientation-probe';
import { jpegOrientation } from '../exif-strip';

describe('orientation probe', () => {
  it('the probe JPEG really is stored 1×2 and tagged Orientation 6', () => {
    const bytes = new Uint8Array(Buffer.from(ORIENTATION_PROBE_JPEG_BASE64, 'base64'));
    expect(jpegOrientation(bytes)).toBe(6);
    expect(ORIENTATION_PROBE_STORED).toEqual({ width: 1, height: 2 });
    // SOF0 frame header carries height then width (big-endian) — 2 × 1.
    const hex = Buffer.from(bytes).toString('hex');
    expect(hex).toContain('ffc0001108' + '0002' + '0001');
  });

  it('only the swapped size proves the tag was applied', () => {
    expect(exifHonoured(2, 1)).toBe(true);
    expect(exifHonoured(1, 2)).toBe(false); // ignored the tag
    expect(exifHonoured(0, 0)).toBe(false); // failed decode
    expect(exifHonoured(2, 2)).toBe(false);
  });
});
