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
 *
 * ORIENTATION (Capture v2, Sep 2026): the EXIF Orientation tag lives in the
 * same APP1 segment as the GPS, so the plain strip left phone portraits
 * stored sideways. `stripJpegMetadataKeepOrientation` drops the segment and
 * writes back a MINIMAL APP1 carrying only that one tag (26-byte TIFF, one
 * IFD entry) when the source declared a non-upright orientation. Zero
 * decode, zero canvas — a byte-level copy like the strip itself. Browsers,
 * Next's image optimizer (sharp auto-orients) and the media proxy all honour
 * the tag, so un-edited captures display upright without a bake.
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

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const TAG_ORIENTATION = 0x0112;
const TYPE_SHORT = 3;
const APP0 = 0xe0;

/**
 * The EXIF Orientation value (1–8) declared by a JPEG, or null when the file
 * declares none (no EXIF APP1, tag absent) or anything is malformed. Pure and
 * bounds-checked throughout; never throws on hostile bytes. 1 = upright, so
 * callers treat `null` and `1` the same way.
 */
export function jpegOrientation(bytes: Uint8Array): number | null {
  if (bytes.length < 4 || ((bytes[0] << 8) | bytes[1]) !== SOI) return null;

  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === SOS || marker === EOI) return null; // no APP1 before the scan
    if (isStandalone(marker)) {
      i += 2;
      continue;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) return null;
    const payloadStart = i + 4;
    const segEnd = i + 2 + len;

    if (marker === APP1 && segEnd - payloadStart >= EXIF_HEADER.length + 8) {
      const isExif = EXIF_HEADER.every((b, k) => bytes[payloadStart + k] === b);
      if (isExif) return readTiffOrientation(bytes, payloadStart + EXIF_HEADER.length, segEnd);
      // XMP or another APP1 flavour — keep looking; EXIF may follow.
    }
    i = segEnd;
  }
  return null;
}

/** IFD0 walk of the TIFF block that follows "Exif\0\0"; null on any anomaly. */
function readTiffOrientation(bytes: Uint8Array, tiff: number, end: number): number | null {
  if (tiff + 8 > end) return null;
  const b0 = bytes[tiff];
  const b1 = bytes[tiff + 1];
  let little: boolean;
  if (b0 === 0x49 && b1 === 0x49) little = true; // "II"
  else if (b0 === 0x4d && b1 === 0x4d) little = false; // "MM"
  else return null;

  const u16 = (at: number): number | null => {
    if (at < tiff || at + 2 > end) return null;
    return little ? bytes[at] | (bytes[at + 1] << 8) : (bytes[at] << 8) | bytes[at + 1];
  };
  const u32 = (at: number): number | null => {
    if (at < tiff || at + 4 > end) return null;
    return little
      ? (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
      : ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
  };

  if (u16(tiff + 2) !== 0x2a) return null;
  const ifdOffset = u32(tiff + 4);
  if (ifdOffset === null || ifdOffset < 8) return null;
  const ifd = tiff + ifdOffset;
  const count = u16(ifd);
  if (count === null) return null;

  for (let n = 0; n < count; n++) {
    const entry = ifd + 2 + n * 12;
    const tag = u16(entry);
    if (tag === null) return null; // truncated directory
    if (tag !== TAG_ORIENTATION) continue;
    const type = u16(entry + 2);
    const cnt = u32(entry + 4);
    if (type !== TYPE_SHORT || cnt !== 1) return null;
    // A SHORT with count 1 is stored inline in the value field's first 2 bytes.
    const value = u16(entry + 8);
    return value !== null && value >= 1 && value <= 8 ? value : null;
  }
  return null;
}

/**
 * A complete APP1 segment (marker + length + "Exif\0\0" + a 26-byte big-endian
 * TIFF) whose ONLY tag is Orientation. 36 bytes total. Exported for the test.
 */
export function orientationApp1(orientation: number): Uint8Array {
  const o = Math.min(8, Math.max(1, Math.round(orientation)));
  const tiff = [
    0x4d, 0x4d, // "MM" big-endian
    0x00, 0x2a, // 42
    0x00, 0x00, 0x00, 0x08, // IFD0 at offset 8
    0x00, 0x01, // one entry
    0x01, 0x12, // tag: Orientation
    0x00, 0x03, // type: SHORT
    0x00, 0x00, 0x00, 0x01, // count: 1
    0x00, o, 0x00, 0x00, // value (SHORT, inline, left-aligned)
    0x00, 0x00, 0x00, 0x00, // next IFD: none
  ];
  const payload = [...EXIF_HEADER, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, APP1, (len >> 8) & 0xff, len & 0xff, ...payload]);
}

/**
 * `stripJpegMetadata`, plus: when the source declared a non-upright EXIF
 * Orientation, a minimal APP1 carrying only that tag is written back (after
 * APP0/JFIF when present, else right after SOI). Returns the input BY
 * REFERENCE when nothing was stripped, exactly like the plain strip.
 */
export function stripJpegMetadataKeepOrientation(bytes: Uint8Array): Uint8Array {
  const orientation = jpegOrientation(bytes);
  const stripped = stripJpegMetadata(bytes);
  if (stripped === bytes || orientation === null || orientation === 1) return stripped;

  let insertAt = 2; // after SOI
  if (stripped.length >= 6 && stripped[2] === 0xff && stripped[3] === APP0) {
    const len = (stripped[4] << 8) | stripped[5];
    if (len >= 2 && 2 + 2 + len <= stripped.length) insertAt = 2 + 2 + len;
  }
  const app1 = orientationApp1(orientation);
  const out = new Uint8Array(stripped.length + app1.length);
  out.set(stripped.subarray(0, insertAt), 0);
  out.set(app1, insertAt);
  out.set(stripped.subarray(insertAt), insertAt + app1.length);
  return out;
}
