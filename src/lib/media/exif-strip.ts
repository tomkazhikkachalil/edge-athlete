/**
 * Lossless JPEG metadata strip (pure — unit-tested in exif-strip.test.ts).
 *
 * Phone-camera JPEGs carry GPS coordinates in the EXIF APP1 segment; XMP
 * (also APP1) and IPTC (APP13) can carry location and identifying data too.
 * The media editor strips all of this as a side effect of canvas re-encode,
 * but un-edited uploads and the preserved non-destructive originals went up
 * byte-for-byte. Re-encoding those would cost image quality, so this strips
 * at the byte level instead: drop APP1 and APP13 segments, keep everything
 * that affects decoding or color (APP0/JFIF, APP2/ICC profile, APP14/Adobe),
 * and copy from SOS onward verbatim.
 *
 * Scope (documented honestly in the composer): JPEG only — the format where
 * GPS actually arrives in practice. PNG screenshots don't carry GPS; video
 * containers are not touched client-side (Wave 1 scope).
 *
 * Fail-open by design: anything unparseable returns the input unchanged —
 * an upload must never fail because a scrubber choked. Callers may compare
 * the return value by reference to detect a no-op.
 */

const SOI = 0xffd8;
const SOS = 0xda;
const EOI = 0xd9;
const APP1 = 0xe1;
const APP13 = 0xed;

/** Standalone markers with no length field (RSTn, TEM). */
function isStandalone(marker: number): boolean {
  return (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01;
}

export function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  // Not a JPEG → untouched.
  if (bytes.length < 4 || ((bytes[0] << 8) | bytes[1]) !== SOI) return bytes;

  const keep: Array<[number, number]> = [[0, 2]]; // SOI itself
  let i = 2;
  let dropped = false;

  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes; // desynced — bail untouched
    const marker = bytes[i + 1];

    if (marker === SOS) {
      // Entropy-coded data follows — metadata segments can't appear after
      // this point, so keep the rest of the file verbatim.
      keep.push([i, bytes.length]);
      break;
    }
    if (marker === EOI) {
      keep.push([i, bytes.length]);
      break;
    }
    if (isStandalone(marker)) {
      keep.push([i, i + 2]);
      i += 2;
      continue;
    }

    const len = (bytes[i + 2] << 8) | bytes[i + 3]; // includes the 2 length bytes
    if (len < 2 || i + 2 + len > bytes.length) return bytes; // corrupt — bail
    const segEnd = i + 2 + len;

    if (marker === APP1 || marker === APP13) {
      dropped = true; // EXIF/XMP (APP1) or IPTC (APP13) — drop
    } else {
      keep.push([i, segEnd]);
    }
    i = segEnd;
  }

  if (!dropped) return bytes;

  const total = keep.reduce((n, [a, b]) => n + (b - a), 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const [a, b] of keep) {
    out.set(bytes.subarray(a, b), off);
    off += b - a;
  }
  return out;
}
