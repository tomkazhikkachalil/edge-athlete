// ── Terrain Tiles: free elevation, no key (Golf course flow fixes T1, Oct 2026)
// AWS Open Data hosts Mapzen's Terrain Tiles — a global bare-earth DEM cut
// into Web Mercator PNG tiles, free to read with no account or key, under an
// attribution-only licence (3DEP 10 m in the US, CDEM in Canada, SRTM 30 m
// elsewhere; see docs/GOLF_COURSE_DATA.md for the credit line). That is
// FINER than Open-Meteo's 90 m DEM and costs nothing, which is why it is the
// first provider for the "plays like" profile; Open-Meteo stays a fallback
// behind its paid key. Terrarium encoding: each pixel's RGB holds metres as
// `R·256 + G + B/256 − 32768`.
//
// Pure maths only — the fetch and the PNG decode live in elevation-server.ts
// (sharp is server-only and never loads in a unit test).

import type { LatLng } from '@/lib/golf/elevation';

export const TERRAIN_ZOOM = 14;
export const TILE_SIZE = 256;
const MAX_LAT = 85.05112878;

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** The public S3 URL of a terrarium tile. */
export function terrainTileUrl(t: Tile): string {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${t.z}/${t.x}/${t.y}.png`;
}

const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

/** Fractional Web Mercator tile coordinates (x east, y south) at zoom z. */
function mercator(lat: number, lng: number, z: number): [number, number] {
  const n = 2 ** z;
  const latRad = (clampLat(lat) * Math.PI) / 180;
  const x = ((lng + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
}

/** The tile a point falls in. */
export function tileFor(lat: number, lng: number, z: number = TERRAIN_ZOOM): Tile {
  const [x, y] = mercator(lat, lng, z);
  const n = 2 ** z;
  return { z, x: Math.min(n - 1, Math.max(0, Math.floor(x))), y: Math.min(n - 1, Math.max(0, Math.floor(y))) };
}

/** The point's fractional pixel position inside `tile` (0 ≤ px, py < 256
 *  when the point is in the tile). */
export function pixelIn(tile: Tile, lat: number, lng: number): { px: number; py: number } {
  const [x, y] = mercator(lat, lng, tile.z);
  return { px: (x - tile.x) * TILE_SIZE, py: (y - tile.y) * TILE_SIZE };
}

/** Terrarium RGB → metres. */
export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

/** Bilinear elevation at a fractional pixel position over a decoded raw
 *  tile (`data` row-major, `channels` bytes per pixel, the first three RGB).
 *  Pixel centres sit at i + 0.5; the edge pixels clamp. */
export function sampleBilinear(
  data: Uint8Array | Buffer,
  width: number,
  height: number,
  channels: number,
  px: number,
  py: number
): number {
  const at = (x: number, y: number) => {
    const i = (y * width + x) * channels;
    return decodeTerrarium(data[i], data[i + 1], data[i + 2]);
  };
  const fx = Math.min(width - 1, Math.max(0, px - 0.5));
  const fy = Math.min(height - 1, Math.max(0, py - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const bottom = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

export const tileKey = (t: Tile) => `${t.z}/${t.x}/${t.y}`;

/** Group coordinates by the tile each one falls in, keeping their indexes
 *  so a profile can be reassembled in order after the tiles are read. */
export function groupByTile(coords: LatLng[], z: number = TERRAIN_ZOOM): Map<string, { tile: Tile; indexes: number[] }> {
  const groups = new Map<string, { tile: Tile; indexes: number[] }>();
  coords.forEach((c, i) => {
    const tile = tileFor(c[0], c[1], z);
    const key = tileKey(tile);
    const g = groups.get(key);
    if (g) g.indexes.push(i);
    else groups.set(key, { tile, indexes: [i] });
  });
  return groups;
}
