/**
 * Is this file a HEIF/HEIC container? (every-phone round PR 6, Oct 9 2026).
 * Zero imports; the decode fallback and the tests read it.
 *
 * A Samsung with "high efficiency pictures" on hands the browser a HEIC
 * file; Chrome on Android cannot decode it, and an Android camera sometimes
 * hands the file with an EMPTY type. So the question is answered twice: by
 * the declared MIME, and by the ISO BMFF brand in the first 12 bytes —
 * `....ftyp<brand>` where the brand is one of the HEIF family
 * (strukturag/libheif#83). iPhones never reach this: Safari transcodes a
 * HEIC to JPEG before a web page sees it.
 */

export const HEIF_MIME_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'] as const;

/** Major brands of the HEIF family (still images and sequences). */
export const HEIF_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'] as const;

/** The first 12 bytes are enough: size (4) + 'ftyp' (4) + the major brand (4). */
export const HEIF_SNIFF_BYTES = 12;

export function isHeifMime(mime: string): boolean {
  return (HEIF_MIME_TYPES as readonly string[]).includes(mime.toLowerCase());
}

/** True when the bytes open with an `ftyp` box whose major brand is HEIF's. */
export function isHeifBrand(bytes: Uint8Array): boolean {
  if (bytes.length < HEIF_SNIFF_BYTES) return false;
  if (ascii(bytes, 4, 8) !== 'ftyp') return false;
  const brand = ascii(bytes, 8, 12).replace(/\0/g, ' ').trim();
  return (HEIF_BRANDS as readonly string[]).includes(brand);
}

/** The decode fallback's gate: the declared type, else the bytes. */
export function isHeifCandidate(mime: string, head: Uint8Array): boolean {
  return isHeifMime(mime) || isHeifBrand(head);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
