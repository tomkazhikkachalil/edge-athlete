import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { decodePng } from '../png-decode';
import { fetchElevationsTerrain } from '../elevation-server';
import { decodeTerrarium } from '../terrain-tiles';

// Nov 17 2026: the terrain tiles are decoded without sharp (sharp is not in
// the functions that sample elevation, so production saved no profile). The
// reference here IS sharp, which the test machine has: two real tiles, every
// byte equal.

const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
const TILES = ['terrarium-14-4743-5858.png', 'terrarium-14-2620-6332.png'];

const viaSharp = async (png: Uint8Array) => {
  const { data, info } = await sharp(Buffer.from(png)).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height, channels: info.channels };
};

/** A PNG built by hand, so each row filter and each refusal can be named. */
function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  new DataView(out.buffer).setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  return out; // CRC left zero: the decoder does not read it
}
function png(opts: { width: number; height: number; colour: number; depth?: number; interlace?: number; rows: number[][] }): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, opts.width);
  v.setUint32(4, opts.height);
  ihdr[8] = opts.depth ?? 8;
  ihdr[9] = opts.colour;
  ihdr[12] = opts.interlace ?? 0;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(Buffer.from(opts.rows.flat())))), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('decodePng', () => {
  for (const name of TILES) {
    it(`reads the real terrain tile ${name} exactly as sharp does`, async () => {
      const bytes = fixture(name);
      const ours = decodePng(bytes);
      const theirs = await viaSharp(bytes);
      expect({ width: ours.width, height: ours.height, channels: ours.channels }).toEqual({ width: 256, height: 256, channels: theirs.channels });
      expect(ours.data.length).toBe(theirs.data.length);
      expect(Buffer.compare(Buffer.from(ours.data), Buffer.from(theirs.data))).toBe(0);
    });
  }

  it('reads an RGBA image with adaptive row filters exactly as sharp does', async () => {
    const w = 37;
    const h = 29;
    const raw = Buffer.alloc(w * h * 4);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 31 + ((i * i) % 97) + (i >> 3)) & 0xff;
    const encoded = new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png({ adaptiveFiltering: true }).toBuffer());
    const ours = decodePng(encoded);
    expect(ours).toMatchObject({ width: w, height: h, channels: 4 });
    expect(Buffer.compare(Buffer.from(ours.data), raw)).toBe(0);
  });

  it('undoes each of the five row filters', () => {
    // 2 × 1 RGB rows; the first row is plain so the later filters have an "above".
    const first = [0, 10, 20, 30, 40, 50, 60];
    const expectRow = (filter: number, bytes: number[], want: number[]) => {
      const d = decodePng(png({ width: 2, height: 2, colour: 2, rows: [first, [filter, ...bytes]] }));
      expect([...d.data.slice(6)]).toEqual(want);
    };
    expectRow(0, [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]);
    expectRow(1, [1, 2, 3, 4, 5, 6], [1, 2, 3, 5, 7, 9]); // + left
    expectRow(2, [1, 2, 3, 4, 5, 6], [11, 22, 33, 44, 55, 66]); // + above
    expectRow(3, [1, 2, 3, 4, 5, 6], [6, 12, 18, 27, 36, 45]); // + floor((left + above) / 2)
    expectRow(4, [1, 2, 3, 4, 5, 6], [11, 22, 33, 44, 55, 66]); // + paeth (above wins on these values)
  });

  it('refuses what it was not written for, by throwing', () => {
    const rows = [[0, 1, 2, 3]];
    expect(() => decodePng(new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => decodePng(new Uint8Array(64))).toThrow('not a PNG');
    expect(() => decodePng(png({ width: 1, height: 1, colour: 3, rows }))).toThrow('unsupported'); // palette
    expect(() => decodePng(png({ width: 1, height: 1, colour: 2, depth: 16, rows }))).toThrow('unsupported');
    expect(() => decodePng(png({ width: 1, height: 1, colour: 2, interlace: 1, rows }))).toThrow('unsupported');
    expect(() => decodePng(png({ width: 1, height: 1, colour: 2, rows: [[9, 1, 2, 3]] }))).toThrow('filter');
    expect(() => decodePng(png({ width: 2, height: 1, colour: 2, rows }))).toThrow(); // fewer bytes than the header promises
    expect(() => decodePng(fixture(TILES[0]).slice(0, 5000))).toThrow(); // a cut-off download
  });

  it('gives a plausible height for a known place through the default decoder', async () => {
    // The tile north of Ottawa (45.55, -75.78): land in the Gatineau hills, above the river and under 450 m.
    const d = decodePng(fixture(TILES[0]));
    const heights: number[] = [];
    for (let i = 0; i < d.data.length; i += d.channels * 257) heights.push(decodeTerrarium(d.data[i], d.data[i + 1], d.data[i + 2]));
    expect(Math.min(...heights)).toBeGreaterThan(20);
    expect(Math.max(...heights)).toBeLessThan(450);
    // And the server path uses this decoder when none is injected (no network: an empty list never fetches).
    expect(await fetchElevationsTerrain([])).toEqual({ reached: false, elev: null });
  });
});
