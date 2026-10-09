import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { HEIF_SNIFF_BYTES, isHeifBrand, isHeifCandidate, isHeifMime } from '../media/heic-brand';

const ftyp = (brand: string) => {
  const b = new Uint8Array(16);
  b.set([0, 0, 0, 0x18]);
  b.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
  for (let i = 0; i < 4; i++) b[8 + i] = brand.charCodeAt(i);
  return b;
};

describe('heic-brand — the HEIF family by type and by bytes', () => {
  it('knows the HEIF MIME types, case-insensitively, and nothing else', () => {
    expect(isHeifMime('image/heic')).toBe(true);
    expect(isHeifMime('image/HEIF')).toBe(true);
    expect(isHeifMime('image/jpeg')).toBe(false);
    expect(isHeifMime('')).toBe(false);
  });

  it('reads the major brand of an ftyp box', () => {
    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']) expect(isHeifBrand(ftyp(brand))).toBe(true);
    expect(isHeifBrand(ftyp('isom'))).toBe(false); // an MP4
    expect(isHeifBrand(ftyp('avif'))).toBe(false); // AVIF is its own family
    expect(isHeifBrand(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false); // a JPEG
    expect(isHeifBrand(new Uint8Array(4))).toBe(false); // too short
  });

  it('recognises the committed fixture (made with sips) from its first bytes alone', () => {
    const bytes = new Uint8Array(readFileSync('e2e/fixtures/photo.heic'));
    expect(isHeifBrand(bytes.subarray(0, HEIF_SNIFF_BYTES))).toBe(true);
    expect(isHeifCandidate('', bytes.subarray(0, HEIF_SNIFF_BYTES))).toBe(true); // Android's empty type
    const png = new Uint8Array(readFileSync('e2e/fixtures/photo.png'));
    expect(isHeifCandidate('image/png', png.subarray(0, HEIF_SNIFF_BYTES))).toBe(false);
    expect(isHeifCandidate('', png.subarray(0, HEIF_SNIFF_BYTES))).toBe(false);
  });
});
