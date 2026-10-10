import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { IMAGE_MISMATCH_ERROR, prepareImage, sniffImage, stripImageMetadata } from '../image-meta';

// The server's image check (maintenance pass, Oct 10 2026): the bytes must be
// the declared image, and location / identifying metadata leaves losslessly.

function seg(marker: number, payload: number[]): number[] {
  const len = payload.length + 2;
  return [0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload];
}
const SCAN = [0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x12, 0xff, 0x00, 0x34, 0xff, 0xd9];
const GPS = Array.from(Buffer.from('Exif\0\0GPS-45.4215,-75.6972'));
const jpeg = (...mid: number[][]) => new Uint8Array([0xff, 0xd8, ...mid.flat(), ...SCAN]);

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(type), data])) >>> 0);
  return Buffer.concat([len, Buffer.from(type), data, crc]);
}
const IHDR = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const png = (...chunks: Buffer[]) =>
  new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', IHDR), ...chunks, pngChunk('IDAT', Buffer.from([1, 2, 3])), pngChunk('IEND', Buffer.alloc(0))]));

function riffChunk(fourcc: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(fourcc), size, data, data.length & 1 ? Buffer.from([0]) : Buffer.alloc(0)]);
}
function webp(...chunks: Buffer[]): Uint8Array {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks]);
  const size = Buffer.alloc(4);
  size.writeUInt32LE(body.length);
  return new Uint8Array(Buffer.concat([Buffer.from('RIFF'), size, body]));
}
const vp8x = (flags: number) => riffChunk('VP8X', Buffer.from([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]));

describe('sniffImage', () => {
  it('reads the format from the bytes, never the name', () => {
    expect(sniffImage(jpeg())).toBe('image/jpeg');
    expect(sniffImage(png())).toBe('image/png');
    expect(sniffImage(new Uint8Array(Buffer.from('GIF89a......')))).toBe('image/gif');
    expect(sniffImage(webp(riffChunk('VP8 ', Buffer.from([1, 2]))))).toBe('image/webp');
    expect(sniffImage(new Uint8Array(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))).toBeNull();
    expect(sniffImage(new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]))).toBeNull(); // an MP4/HEIC box
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe('prepareImage', () => {
  it('refuses bytes that are not the declared image', () => {
    expect(prepareImage(png(), 'image/jpeg')).toEqual({ ok: false, error: IMAGE_MISMATCH_ERROR });
    expect(prepareImage(new Uint8Array(Buffer.from('<html>')), 'image/png')).toEqual({ ok: false, error: IMAGE_MISMATCH_ERROR });
  });

  it('JPEG: the EXIF/GPS segment leaves; the image data is untouched', () => {
    const input = jpeg(seg(0xe1, GPS), seg(0xdb, [0]));
    const out = prepareImage(input, 'image/jpeg');
    expect(out.ok && out.changed).toBe(true);
    const hex = out.ok ? Buffer.from(out.bytes).toString('hex') : '';
    expect(hex).not.toContain(Buffer.from('GPS').toString('hex'));
    expect(hex.endsWith(Buffer.from(SCAN).toString('hex'))).toBe(true);
    // Already clean → unchanged, the same bytes.
    const clean = jpeg(seg(0xdb, [0]));
    const again = prepareImage(clean, 'image/jpeg');
    expect(again).toEqual({ ok: true, bytes: clean, changed: false });
  });

  it('PNG: eXIf and text chunks leave; IHDR / IDAT / IEND stay', () => {
    const input = png(pngChunk('eXIf', Buffer.from(GPS)), pngChunk('tEXt', Buffer.from('Comment\0at home')));
    const out = stripImageMetadata(input, 'image/png');
    expect(out.changed).toBe(true);
    const s = Buffer.from(out.bytes).toString('latin1');
    expect(s).not.toContain('eXIf');
    expect(s).not.toContain('GPS');
    expect(s).not.toContain('at home');
    expect(s).toContain('IHDR');
    expect(s).toContain('IDAT');
    expect(s).toContain('IEND');
    expect(stripImageMetadata(png(), 'image/png').changed).toBe(false);
  });

  it('WebP: EXIF and XMP chunks leave, their VP8X flags clear, the RIFF size follows', () => {
    const input = webp(vp8x(0x08 | 0x04 | 0x10), riffChunk('VP8 ', Buffer.from([9, 9, 9])), riffChunk('EXIF', Buffer.from(GPS)), riffChunk('XMP ', Buffer.from('<x:xmpmeta/>')));
    const out = stripImageMetadata(input, 'image/webp');
    expect(out.changed).toBe(true);
    const b = Buffer.from(out.bytes);
    expect(b.toString('latin1')).not.toContain('GPS');
    expect(b.toString('latin1')).not.toContain('xmpmeta');
    expect(b.readUInt32LE(4)).toBe(b.length - 8);
    expect(b[20] & 0x0c).toBe(0); // VP8X flags byte: EXIF + XMP cleared
    expect(b[20] & 0x10).toBe(0x10); // the alpha flag kept
    expect(sniffImage(out.bytes)).toBe('image/webp');
  });

  it('a malformed file goes through unchanged (fail-open, like the device strip)', () => {
    const broken = new Uint8Array([...png().subarray(0, 20), 0xff, 0xff, 0xff, 0xff]);
    expect(stripImageMetadata(broken, 'image/png')).toEqual({ bytes: broken, changed: false });
  });
});
