// ── Encoded polylines (Google's algorithm, precision 5) — pure ─────────────
// The route preview on the activities row is one short ASCII string — the
// format Strava and Google also use, so a later provider's summary polyline
// can be stored as-is. Precision 5 ≈ 1 m, plenty for a thumbnail.

export type LatLng = [number, number];

function encodeValue(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}

export function encodePolyline(coords: readonly LatLng[]): string {
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  for (const [lat, lng] of coords) {
    const la = Math.round(lat * 1e5);
    const ln = Math.round(lng * 1e5);
    out += encodeValue(la - prevLat) + encodeValue(ln - prevLng);
    prevLat = la;
    prevLng = ln;
  }
  return out;
}

/** Decode; a malformed string yields the points read so far (never throws). */
export function decodePolyline(s: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let shift = 0;
    let result = 0;
    for (;;) {
      if (i >= s.length) return null;
      const b = s.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) return null;
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (b < 0x20) break;
      if (shift > 30) return null;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
