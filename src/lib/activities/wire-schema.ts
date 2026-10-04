// ── The import payload's server-side schema (zod) ──────────────────────────
// Refuses what toWire() could not have produced: too many samples, columns
// of the wrong length, values outside physics. Totals are NOT in the
// payload — the server computes them (normalize.summarize).

import { z } from 'zod';
import { ACTIVITY_TYPES } from './catalog';
import { UPLOAD_POINTS } from './normalize';
import { SegmentsSchema } from './segments';
import type { WireActivity } from './wire';

const col = (lo: number, hi: number) => z.array(z.number().min(lo).max(hi).nullable()).max(UPLOAD_POINTS).optional();
const nonNeg = (hi: number) => z.number().min(0).max(hi).optional();

export const WireActivitySchema = z
  .object({
    v: z.literal(1),
    format: z.enum(['gpx', 'tcx', 'live']),
    type: z.enum(ACTIVITY_TYPES),
    name: z.string().trim().max(120).nullable(),
    tz: z.string().min(1).max(64).nullable(),
    device: z
      .object({
        distanceM: nonNeg(2_000_000),
        elapsedS: nonNeg(172_800),
        movingS: nonNeg(172_800),
        elevGainM: nonNeg(30_000),
        elevLossM: nonNeg(30_000),
        calories: nonNeg(50_000),
      })
      .strict(),
    t0: z.number().int().min(0),
    dt: z.array(z.number().int().min(0).max(172_800_000)).min(2).max(UPLOAD_POINTS),
    lat: col(-90, 90),
    lng: col(-180, 180),
    ele: col(-500, 9000),
    hr: col(0, 300),
    cad: col(0, 400),
    pwr: col(0, 3000),
    dist: col(0, 2_000_000),
    // Live Activities (251): the recorder's own id and the segments it marked.
    recordingId: z.string().uuid().optional(),
    segments: SegmentsSchema.optional(),
  })
  .strict()
  .superRefine((w, ctx) => {
    const n = w.dt.length;
    for (const k of ['lat', 'lng', 'ele', 'hr', 'cad', 'pwr', 'dist'] as const) {
      const c = w[k];
      if (c && c.length !== n) ctx.addIssue({ code: 'custom', path: [k], message: `${k} must have one value per sample` });
    }
    if ((w.lat === undefined) !== (w.lng === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['lat'], message: 'lat and lng travel together' });
    }
    // A recording names itself; a file never carries the recorder's fields.
    if (w.format === 'live' && !w.recordingId) {
      ctx.addIssue({ code: 'custom', path: ['recordingId'], message: 'a live recording names its recordingId' });
    }
    if (w.format !== 'live' && (w.recordingId !== undefined || w.segments !== undefined)) {
      ctx.addIssue({ code: 'custom', path: ['format'], message: 'recordingId and segments belong to a live recording' });
    }
    // Every segment ends inside the recording (a second of slack for rounding).
    if (w.segments) {
      const lastS = w.dt[w.dt.length - 1] / 1000;
      w.segments.forEach((seg, i) => {
        if (seg.to_s > lastS + 1) ctx.addIssue({ code: 'custom', path: ['segments', i, 'to_s'], message: 'a segment ends inside the recording' });
      });
    }
  });

export function parseWireActivity(raw: unknown): { ok: true; value: WireActivity } | { ok: false; error: string } {
  const r = WireActivitySchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data as WireActivity };
  const issue = r.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid activity.' };
}
