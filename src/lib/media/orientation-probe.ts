/**
 * Does this browser's `createImageBitmap(blob, { imageOrientation: 'from-image' })`
 * actually honour EXIF orientation? WebKit accepted the option long before it
 * implemented it (EXIF in ImageBitmap landed Aug 2022 — Safari/iOS 16.x); on an
 * older WebKit the call succeeds, the pixels come back UNROTATED, and the
 * orientation bake in upload.ts then strips the tag — a sideways photo at
 * full cost. So decode.ts asks once, with a real probe, instead of trusting
 * the option bag.
 *
 * The probe: a 955-byte JPEG stored 1 wide × 2 tall and tagged Orientation 6
 * (generated with sharp, Sep 2026). A decoder that honours the tag returns a
 * 2×1 bitmap; one that ignores it returns 1×2. `exifHonoured` is the pure
 * decision (unit-tested); the DOM part lives in decode.ts.
 */

export const ORIENTATION_PROBE_STORED = { width: 1, height: 2 } as const;

export const ORIENTATION_PROBE_JPEG_BASE64 =
  '/9j/4QC8RXhpZgAASUkqAAgAAAAGABIBAwABAAAABgAAABoBBQABAAAAVgAAABsBBQABAAAAXgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAZgAAAAAAAAA4YwAA6AMAADhjAADoAwAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAEAAAADoAQAAQAAAAIAAAAAAAAA/+IB8ElDQ19QUk9GSUxFAAEBAAAB4GxjbXMEIAAAbW50clJHQiBYWVogB+IAAwAUAAkADgAdYWNzcE1TRlQAAAAAc2F3c2N0cmwAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1oYW5keem/Vlo+AbaDI4VVRvdPqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKZGVzYwAAAPwAAAAkY3BydAAAASAAAAAid3RwdAAAAUQAAAAUY2hhZAAAAVgAAAAsclhZWgAAAYQAAAAUZ1hZWgAAAZgAAAAUYlhZWgAAAawAAAAUclRSQwAAAcAAAAAgZ1RSQwAAAcAAAAAgYlRSQwAAAcAAAAAgbWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCbWx1YwAAAAAAAAABAAAADGVuVVMAAAAGAAAAHABDAEMAMAAAWFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDD8AAAXd///zJgAAB5AAAP2S///7of///aIAAAPcAADAcVhZWiAAAAAAAABvoAAAOPIAAAOPWFlaIAAAAAAAAGKWAAC3iQAAGNpYWVogAAAAAAAAJKAAAA+FAAC2xHBhcmEAAAAAAAMAAAACZmkAAPKnAAANWQAAE9AAAApb/9sAQwAQCwwODAoQDg0OEhEQExgoGhgWFhgxIyUdKDozPTw5Mzg3QEhcTkBEV0U3OFBtUVdfYmdoZz5NcXlwZHhcZWdj/9sAQwEREhIYFRgvGhovY0I4QmNjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2Nj/8AAEQgAAgABAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAH/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCfgA//2Q==';

/** The decision from a measured bitmap size: only a SWAPPED size proves the
 *  tag was applied. Anything else (unrotated, or a failed/odd decode) means
 *  "do not trust createImageBitmap for orientation". */
export function exifHonoured(width: number, height: number): boolean {
  return width === ORIENTATION_PROBE_STORED.height && height === ORIENTATION_PROBE_STORED.width;
}

export function orientationProbeBytes(): Uint8Array {
  const bin = atob(ORIENTATION_PROBE_JPEG_BASE64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
