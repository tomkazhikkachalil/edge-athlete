// ── Segments (Live Activities, mig 251) — pure, zod only ────────────────────
// A segment is a TIME RANGE inside an activity the athlete marked — a sprint,
// a climb, an interval, a recovery, a lap — during the recording (the Mark
// button) or after (the activity page). Boundaries only: what a segment
// MEASURES (distance, time, pace, elevation, heart rate) is computed from the
// stream at read time (stream.ts segmentStats), never stored — a stored
// summary would drift every time a richer stream replaced the first.
//
// Overlap is allowed (a climb may hold a sprint; the recorder's Mark button
// only ever produces sequential ones). The stored shape is what the DB CHECK
// cannot say: `activities_segments_check` holds the array and the cap, this
// file holds the element.

import { z } from 'zod';

export const SEGMENT_KINDS = ['sprint', 'climb', 'interval', 'recovery', 'lap'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export const SEGMENT_KIND_LABELS: Readonly<Record<SegmentKind, string>> = {
  sprint: 'Sprint',
  climb: 'Climb',
  interval: 'Interval',
  recovery: 'Recovery',
  lap: 'Lap',
};

/** The DB CHECK's cap (251). */
export const SEGMENT_MAX = 50;
/** Shorter than this is a mis-tap, not a segment. */
export const SEGMENT_MIN_S = 5;
export const SEGMENT_LABEL_MAX = 40;

export interface ActivitySegment {
  id: string;
  kind: SegmentKind;
  /** Seconds from the activity's start. */
  from_s: number;
  to_s: number;
  label?: string;
}

export const SegmentSchema = z
  .object({
    id: z.string().min(1).max(40),
    kind: z.enum(SEGMENT_KINDS),
    from_s: z.number().int().min(0).max(172_800),
    to_s: z.number().int().min(0).max(172_800),
    label: z.string().trim().min(1).max(SEGMENT_LABEL_MAX).optional(),
  })
  .strict()
  .refine(s => s.to_s - s.from_s >= SEGMENT_MIN_S, { message: `a segment lasts at least ${SEGMENT_MIN_S} s`, path: ['to_s'] });

export const SegmentsSchema = z.array(SegmentSchema).max(SEGMENT_MAX);

export function parseSegments(raw: unknown): { ok: true; value: ActivitySegment[] } | { ok: false; error: string } {
  const r = SegmentsSchema.safeParse(raw);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  return { ok: false, error: issue ? `segments.${issue.path.join('.') || '?'}: ${issue.message}` : 'Invalid segments.' };
}

/**
 * The stored list: clamped to the activity's elapsed seconds, the empties
 * (shorter than SEGMENT_MIN_S once clamped) dropped, sorted by start, ids
 * unique (a later duplicate keeps the first). Idempotent.
 */
export function normalizeSegments(list: readonly ActivitySegment[], elapsedS: number): ActivitySegment[] {
  const end = Math.max(0, Math.floor(elapsedS));
  const seen = new Set<string>();
  const out: ActivitySegment[] = [];
  for (const seg of list) {
    if (seen.has(seg.id)) continue;
    const from = Math.max(0, Math.min(Math.floor(seg.from_s), end));
    const to = Math.max(0, Math.min(Math.floor(seg.to_s), end));
    if (to - from < SEGMENT_MIN_S) continue;
    seen.add(seg.id);
    const next: ActivitySegment = { id: seg.id, kind: seg.kind, from_s: from, to_s: to };
    if (seg.label) next.label = seg.label.trim().slice(0, SEGMENT_LABEL_MAX);
    out.push(next);
  }
  out.sort((a, b) => a.from_s - b.from_s || a.to_s - b.to_s);
  return out.slice(0, SEGMENT_MAX);
}

/** A stored jsonb value → segments, or [] when it is not a list we know. */
export function segmentsFromRow(raw: unknown): ActivitySegment[] {
  const parsed = parseSegments(raw);
  return parsed.ok ? parsed.value : [];
}
