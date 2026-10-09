// ── The browser → server import payload — pure, no zod ─────────────────────
// A .GPX / .TCX is parsed in the browser (a long ride's XML can exceed
// Vercel's 4.5 MB request cap), downsampled to UPLOAD_POINTS and sent as
// this compact columnar JSON — well under 1.5 MB. The server re-validates it
// (wire-schema.ts) and recomputes every total from the points; nothing the
// client computed is trusted. A .FIT never takes this path: it is decoded on
// the server (parse-fit-server.ts — the SDK's license keeps it off clients).
//
// `format: 'live'` (Live Activities, 251) is the phone recorder's finished
// recording — the same columns, plus the recording's own id (the server's
// `external_id`, so a retry never duplicates) and the segments marked on the
// way. It was never a file: the row's source_format is NULL.

import type { ActivityType } from './catalog';
import { downsample, UPLOAD_POINTS } from './normalize';
import type { ActivitySegment } from './segments';
import type { ActivityPoint, DeviceTotals, NormalizedActivity } from './types';

export type WireFormat = 'gpx' | 'tcx' | 'live';

export interface WireActivity {
  v: 1;
  format: WireFormat;
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
  /** `live` only: each fix's reported accuracy (m) — the GPS filter's input. */
  acc?: (number | null)[];
  /** `live` only: the device's id for this recording (→ external_id `live:<id>`). */
  recordingId?: string;
  /** `live` only: the segments marked during the recording. */
  segments?: ActivitySegment[];
}

type Col = 'lat' | 'lng' | 'ele' | 'hr' | 'cad' | 'pwr' | 'dist' | 'acc';
const DP: Readonly<Record<Col, number>> = { lat: 6, lng: 6, ele: 1, hr: 0, cad: 0, pwr: 0, dist: 1, acc: 1 };
const COLS = Object.keys(DP) as Col[];

export function toWire(n: Omit<NormalizedActivity, 'format'> & { format: WireFormat }, tz: string | null): WireActivity {
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
  // A recording was never a file — the row's source_format stays NULL.
  return { format: w.format === 'live' ? null : w.format, type: w.type, name: w.name, points, device: w.device, tzOffsetMin: null };
}
