import { describe, it, expect } from 'vitest';
import { jpegOrientation, stripJpegMetadata } from '../exif-strip';

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

/**
 * A minimal EXIF APP1 payload: "Exif\0\0" + TIFF header + a one-entry IFD0
 * carrying Orientation (0x0112, SHORT, count 1). `extra` entries precede it so
 * the walk has to skip unrelated tags.
 */
function exifPayload(orientation: number, little: boolean, extraEntries = 1): number[] {
  const u16 = (v: number) => (little ? [v & 0xff, v >> 8] : [v >> 8, v & 0xff]);
  const u32 = (v: number) =>
    little
      ? [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]
      : [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  const entries: number[] = [];
  for (let n = 0; n < extraEntries; n++) {
    // 0x010F Make, ASCII (2), count 4, value "abc\0" inline — irrelevant tag
    entries.push(...u16(0x010f), ...u16(2), ...u32(4), 0x61, 0x62, 0x63, 0x00);
  }
  entries.push(...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0x00, 0x00);
  const ifd0 = [...u16(extraEntries + 1), ...entries, ...u32(0)];
  const tiff = [...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(0x2a), ...u32(8), ...ifd0];
  return [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
}

describe('jpegOrientation', () => {
  it('reads Orientation 6 from a little-endian (II) EXIF block', () => {
    const input = jpeg(seg(0xe0, JFIF_PAYLOAD), seg(0xe1, exifPayload(6, true)));
    expect(jpegOrientation(input)).toBe(6);
  });

  it('reads Orientation 3 from a big-endian (MM) EXIF block', () => {
    const input = jpeg(seg(0xe1, exifPayload(3, false, 2)));
    expect(jpegOrientation(input)).toBe(3);
  });

  it('returns null with no APP1 at all', () => {
    expect(jpegOrientation(jpeg(seg(0xe0, JFIF_PAYLOAD), seg(0xdb, [0x00])))).toBeNull();
  });

  it('skips an XMP APP1 and still finds a later EXIF APP1', () => {
    const xmp = [0x68, 0x74, 0x74, 0x70, 0x3a, 0x2f, 0x2f, 0x6e, 0x73, 0x2e, 0x00, 0x00, 0x00, 0x00, 0x00];
    expect(jpegOrientation(jpeg(seg(0xe1, xmp)))).toBeNull();
    expect(jpegOrientation(jpeg(seg(0xe1, xmp), seg(0xe1, exifPayload(8, true))))).toBe(8);
  });

  it('returns null for a truncated IFD, an out-of-range value, and non-JPEG bytes', () => {
    const full = exifPayload(6, true);
    const truncated = full.slice(0, full.length - 10); // cut inside the Orientation entry
    expect(jpegOrientation(jpeg(seg(0xe1, truncated)))).toBeNull();
    expect(jpegOrientation(jpeg(seg(0xe1, exifPayload(9, true))))).toBeNull();
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('does not change what stripJpegMetadata does with the same bytes', () => {
    const input = jpeg(seg(0xe1, exifPayload(6, true)));
    const hex = Buffer.from(stripJpegMetadata(input)).toString('hex');
    expect(hex).not.toContain('ffe1');
  });
});

describe('jpegOrientation on a header slice (upload.ts reads only the first 256KB)', () => {
  const ifd = (orientation: number) => [
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // II, 42, IFD0 at 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, // next IFD
  ];
  const exif = (orientation: number) => [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...ifd(orientation)];

  it('reads the tag when the slice ends after the EXIF APP1, even mid-file', () => {
    const full = jpeg(seg(0xe1, exif(6)), seg(0xdb, new Array(200).fill(0)));
    const head = full.subarray(0, 60); // cuts inside the later DQT segment
    expect(jpegOrientation(head)).toBe(6);
  });

  it('returns null (→ lossless-strip path) when the slice ends before the EXIF APP1', () => {
    const full = jpeg(seg(0xe0, JFIF_PAYLOAD), seg(0xe2, new Array(300).fill(0)), seg(0xe1, exif(6)));
    const head = full.subarray(0, 100); // truncated inside the ICC segment
    expect(jpegOrientation(head)).toBeNull();
    expect(jpegOrientation(full)).toBe(6); // the whole file still reads it
  });
});
