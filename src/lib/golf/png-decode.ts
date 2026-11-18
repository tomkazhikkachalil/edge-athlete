// ── A PNG decoder for the terrain tiles (Nov 17 2026) ───────────────────────
// The elevation tiles are 256 × 256 eight-bit truecolour PNGs. They used to be
// read with sharp, and sharp left every function but the media worker in the
// Nov 7 function diet: from then on each elevation attempt on production
// failed at the decoder (692 attempts on Nov 17, none saved; 228 profiles for
// 15,735 mapped courses). A PNG of this kind is a zlib stream and five row
// filters, so it is decoded here with node:zlib and nothing else: no native
// binding to ship, nothing to trace into a function.
//
// Deliberately narrow: eight-bit RGB or RGBA, not interlaced. Anything else
// throws, and the caller treats a throw as a transport failure (no stamp).

import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  /** Row-major bytes, `channels` per pixel, RGB first. */
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A terrain tile is 256 px; nothing this module is given is ever larger than this. */
const MAX_SIDE = 4096;

const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(png: Uint8Array): DecodedPng {
  if (png.length < 8 + 25 || SIGNATURE.some((v, i) => png[i] !== v)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  let seenHeader = false;
  let ended = false;
  const idat: Uint8Array[] = [];
  for (let o = 8; o + 12 <= png.length; ) {
    const len = be32(png, o);
    const type = String.fromCharCode(png[o + 4], png[o + 5], png[o + 6], png[o + 7]);
    const start = o + 8;
    if (start + len + 4 > png.length) throw new Error('truncated PNG');
    if (type === 'IHDR') {
      if (len !== 13) throw new Error('bad IHDR');
      width = be32(png, start);
      height = be32(png, start + 4);
      const depth = png[start + 8];
      const colour = png[start + 9];
      const interlace = png[start + 12];
      if (depth !== 8 || (colour !== 2 && colour !== 6) || interlace !== 0) throw new Error('unsupported PNG kind');
      if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) throw new Error('bad PNG size');
      channels = colour === 2 ? 3 : 4;
      seenHeader = true;
    } else if (type === 'IDAT') {
      idat.push(png.subarray(start, start + len));
    } else if (type === 'IEND') {
      ended = true;
      break;
    }
    o = start + len + 4; // the chunk's CRC is not checked: zlib's own checksum covers the pixels
  }
  if (!seenHeader || !ended || idat.length === 0) throw new Error('incomplete PNG');

  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height });
  if (raw.length !== (stride + 1) * height) throw new Error('bad PNG data length');

  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const up = dst - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[dst + x - channels] : 0; // left
      const b = y > 0 ? out[up + x] : 0; // above
      const c = y > 0 && x >= channels ? out[up + x - channels] : 0; // above left
      const v = raw[src + x];
      let r: number;
      switch (filter) {
        case 0: r = v; break;
        case 1: r = v + a; break;
        case 2: r = v + b; break;
        case 3: r = v + ((a + b) >> 1); break;
        case 4: r = v + paeth(a, b, c); break;
        default: throw new Error('bad PNG filter');
      }
      out[dst + x] = r & 0xff;
    }
  }
  return { data: out, width, height, channels };
}
