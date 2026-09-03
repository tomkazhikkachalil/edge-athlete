import { describe, it, expect } from 'vitest';
import { stripJpegMetadata } from '../exif-strip';

/** Build a JPEG segment: FF <marker> <len hi> <len lo> <payload…>. */
function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}

const EXIF_PAYLOAD = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x99, 0x88]; // "Exif\0\0" + data
const JFIF_PAYLOAD = [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01];
const ICC_PAYLOAD = [0x49, 0x43, 0x43, 0x5f];
const SCAN = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, /* entropy data incl. a stray FF */ 0x12, 0xff, 0x00, 0x34, 0xff, 0xd9];

function jpeg(...middle: number[][]): Uint8Array {
  return new Uint8Array([0xff, 0xd8, ...middle.flat(), ...SCAN]);
}

describe('stripJpegMetadata', () => {
  it('drops APP1 (EXIF/GPS) and APP13 (IPTC) segments', () => {
    const input = jpeg(seg(0xe1, EXIF_PAYLOAD), seg(0xed, [0x50]), seg(0xdb, [0x00]));
    const out = stripJpegMetadata(input);
    expect(out).not.toBe(input);
    const hex = Buffer.from(out).toString('hex');
    expect(hex).not.toContain('ffe1');
    expect(hex).not.toContain('ffed');
    // The quantization table (FFDB) and the scan survive byte-for-byte.
    expect(hex).toContain('ffdb');
    expect(hex.endsWith(Buffer.from(SCAN).toString('hex'))).toBe(true);
  });

  it('keeps APP0 (JFIF), APP2 (ICC) and APP14 (Adobe) — they affect decode/color', () => {
    const input = jpeg(
      seg(0xe0, JFIF_PAYLOAD),
      seg(0xe1, EXIF_PAYLOAD),
      seg(0xe2, ICC_PAYLOAD),
      seg(0xee, [0x41])
    );
    const hex = Buffer.from(stripJpegMetadata(input)).toString('hex');
    expect(hex).toContain('ffe0');
    expect(hex).toContain('ffe2');
    expect(hex).toContain('ffee');
    expect(hex).not.toContain('ffe1');
  });

  it('returns the input BY REFERENCE when there is nothing to strip (no-op detect)', () => {
    const input = jpeg(seg(0xe0, JFIF_PAYLOAD), seg(0xdb, [0x00]));
    expect(stripJpegMetadata(input)).toBe(input);
  });

  it('leaves non-JPEG bytes untouched', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(stripJpegMetadata(png)).toBe(png);
  });

  it('fails open on corrupt input (truncated segment length)', () => {
    // APP1 claiming 1000 bytes of payload that aren't there.
    const input = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x03, 0xe8, 0x45, 0x78]);
    expect(stripJpegMetadata(input)).toBe(input);
  });

  it('copies everything after SOS verbatim (stray FF bytes in entropy data)', () => {
    const input = jpeg(seg(0xe1, EXIF_PAYLOAD));
    const out = stripJpegMetadata(input);
    const scanHex = Buffer.from(SCAN).toString('hex');
    expect(Buffer.from(out).toString('hex').endsWith(scanHex)).toBe(true);
  });
});
