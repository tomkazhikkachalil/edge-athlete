// ── The browser → server import payload — pure, no zod ─────────────────────
// A .GPX / .TCX is parsed in the browser (a long ride's XML can exceed
// Vercel's 4.5 MB request cap), downsampled to UPLOAD_POINTS and sent as
// this compact columnar JSON — well under 1.5 MB. The server re-validates it
// (wire-schema.ts) and recomputes every total from the points; nothing the
// client computed is trusted. A .FIT never takes this path: it is decoded on
// the server (parse-fit-server.ts — the SDK's license keeps it off clients).

import type { ActivityType } from './catalog';
import { downsample, UPLOAD_POINTS } from './normalize';
import type { ActivityPoint, DeviceTotals, NormalizedActivity } from './types';

export interface WireActivity {
  v: 1;
  format: 'gpx' | 'tcx';
  type: ActivityType;
  name: string | null;
  /** The uploader's IANA zone — decides the local date when the file has none. */
  tz: string | null;
  device: DeviceTotals;
  /** Epoch ms of the first sample; `dt` is ms after it, per sample. */
  t0: number;
  dt: number[];
  lat?: (number | null)[];
  lng?: (number | null)[];
  ele?: (number | null)[];
  hr?: (number | null)[];
  cad?: (number | null)[];
  pwr?: (number | null)[];
  dist?: (number | null)[];
}

type Col = 'lat' | 'lng' | 'ele' | 'hr' | 'cad' | 'pwr' | 'dist';
const DP: Readonly<Record<Col, number>> = { lat: 6, lng: 6, ele: 1, hr: 0, cad: 0, pwr: 0, dist: 1 };
const COLS = Object.keys(DP) as Col[];

export function toWire(n: NormalizedActivity & { format: 'gpx' | 'tcx' }, tz: string | null): WireActivity {
  const pts = downsample(
    n.points.slice().sort((a, b) => a.t - b.t),
    UPLOAD_POINTS
  );
  const t0 = pts.length > 0 ? pts[0].t : 0;
  const w: WireActivity = {
    v: 1,
    format: n.format,
    type: n.type,
    name: n.name,
    tz,
    device: n.device,
    t0,
    dt: pts.map(p => Math.round(p.t - t0)),
  };
  for (const c of COLS) {
    if (!pts.some(p => typeof p[c] === 'number')) continue;
    const f = 10 ** DP[c];
    w[c] = pts.map(p => (typeof p[c] === 'number' ? Math.round((p[c] as number) * f) / f : null));
  }
  return w;
}

export function fromWire(w: WireActivity): NormalizedActivity {
  const points: ActivityPoint[] = w.dt.map((d, i) => {
    const p: ActivityPoint = { t: w.t0 + d };
    for (const c of COLS) {
      const v = w[c]?.[i];
      if (typeof v === 'number') p[c] = v;
    }
    return p;
  });
  return { format: w.format, type: w.type, name: w.name, points, device: w.device, tzOffsetMin: null };
}
