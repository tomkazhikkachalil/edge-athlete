import { describe, it, expect } from 'vitest';
import { stripJpegMetadata, stripJpegMetadataKeepOrientation, jpegOrientation, orientationApp1 } from '../exif-strip';

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

/** A real-shaped EXIF APP1 payload: "Exif\0\0" + big-endian TIFF with one Orientation entry
 *  and one GPS-IFD pointer entry (the thing the strip exists to remove). */
function exifWithOrientation(orientation: number, little = false): number[] {
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) =>
    little ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff] : [(v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const shortValue = (v: number) => (little ? [v & 0xff, v >> 8, 0, 0] : [v >> 8, v & 0xff, 0, 0]);
  const tiff = [
    ...(little ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(0x2a),
    ...u32(8),
    ...u16(2), // two entries
    ...u16(0x0112), ...u16(3), ...u32(1), ...shortValue(orientation), // Orientation
    ...u16(0x8825), ...u16(4), ...u32(1), ...u32(38), // GPS IFD pointer → offset 38
    ...u32(0), // next IFD
    // a GPS IFD with one entry (GPSLatitudeRef = "N")
    ...u16(1), ...u16(0x0001), ...u16(2), ...u32(2), 0x4e, 0x00, 0x00, 0x00, ...u32(0),
  ];
  return [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
}

describe('jpegOrientation', () => {
  it('reads Orientation from big- and little-endian EXIF', () => {
    expect(jpegOrientation(jpeg(seg(0xe1, exifWithOrientation(6))))).toBe(6);
    expect(jpegOrientation(jpeg(seg(0xe1, exifWithOrientation(8, true))))).toBe(8);
    expect(jpegOrientation(jpeg(seg(0xe0, JFIF_PAYLOAD), seg(0xe1, exifWithOrientation(3))))).toBe(3);
  });
  it('is null without EXIF, for XMP-only APP1, for non-JPEG and for corrupt bytes', () => {
    expect(jpegOrientation(jpeg(seg(0xe0, JFIF_PAYLOAD)))).toBeNull();
    expect(jpegOrientation(jpeg(seg(0xe1, [0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x6e, 0x73, 0x2e, 0x61, 0x64, 0x6f, 0x62, 0x65])))).toBeNull();
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x03, 0xe8, 0x45, 0x78]))).toBeNull();
  });
  it('round-trips the minimal APP1 it writes', () => {
    for (const o of [2, 3, 4, 5, 6, 7, 8]) {
      const bytes = new Uint8Array([0xff, 0xd8, ...orientationApp1(o), ...SCAN]);
      expect(jpegOrientation(bytes)).toBe(o);
    }
    expect(orientationApp1(6).length).toBe(36);
  });
});

describe('stripJpegMetadataKeepOrientation', () => {
  it('drops the GPS-bearing APP1 but keeps a minimal Orientation-only APP1', () => {
    const input = jpeg(seg(0xe0, JFIF_PAYLOAD), seg(0xe1, exifWithOrientation(6)), seg(0xed, [0x50]), seg(0xdb, [0x00]));
    const out = stripJpegMetadataKeepOrientation(input);
    expect(out).not.toBe(input);
    const hex = Buffer.from(out).toString('hex');
    expect(hex).not.toContain('8825'); // the GPS pointer is gone
    expect(hex).not.toContain('ffed'); // IPTC gone
    expect(jpegOrientation(out)).toBe(6); // orientation survives
    // placed after APP0 (JFIF convention), before the tables and the scan
    expect(hex.indexOf('ffe0')).toBeLessThan(hex.indexOf('ffe1'));
    expect(hex.indexOf('ffe1')).toBeLessThan(hex.indexOf('ffdb'));
    expect(hex.endsWith(Buffer.from(SCAN).toString('hex'))).toBe(true);
    expect(out.length).toBeLessThan(input.length);
  });
  it('places the APP1 right after SOI when there is no APP0', () => {
    const out = stripJpegMetadataKeepOrientation(jpeg(seg(0xe1, exifWithOrientation(8)), seg(0xdb, [0x00])));
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe1);
    expect(jpegOrientation(out)).toBe(8);
  });
  it('behaves exactly like the plain strip when the photo is upright or untagged', () => {
    const upright = jpeg(seg(0xe1, exifWithOrientation(1)), seg(0xdb, [0x00]));
    expect(Buffer.from(stripJpegMetadataKeepOrientation(upright))).toEqual(Buffer.from(stripJpegMetadata(upright)));
    expect(jpegOrientation(stripJpegMetadataKeepOrientation(upright))).toBeNull();
    const untagged = jpeg(seg(0xe0, JFIF_PAYLOAD), seg(0xdb, [0x00]));
    expect(stripJpegMetadataKeepOrientation(untagged)).toBe(untagged); // by reference
  });
  it('fails open on corrupt input', () => {
    const corrupt = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x03, 0xe8, 0x45, 0x78]);
    expect(stripJpegMetadataKeepOrientation(corrupt)).toBe(corrupt);
  });
});
