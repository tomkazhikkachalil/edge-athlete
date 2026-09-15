/**
 * Per-hole compare-and-set — the pure half (Events program, phase 2b, B3;
 * migration 209 `golf_hole_scores.version`).
 *
 * The unit of a score write is the HOLE, so the conflict guard is per
 * hole: a client sends the `version` it last saw for that hole and the
 * server writes only if the row still carries it. Three shapes:
 *
 *   expected undefined   an old client, or a caller that never looked —
 *                        UNCHECKED: today's upsert (last writer wins)
 *   expected 0           "I saw no score on this hole": an INSERT — a row
 *                        that exists meanwhile is a conflict (23505 on the
 *                        server side maps to the same verdict)
 *   expected n ≥ 1       an UPDATE … WHERE version = n; a different live
 *                        version (or a vanished row) is a conflict
 *
 * A conflict carries the hole's CURRENT row so the client can show
 * "they scored 6, you have 5" and resend with `current.version` — a real
 * CAS, never a forced overwrite. `hole-scores-server.ts` performs the
 * writes this plans. No I/O here.
 */

export interface HoleCurrent {
  version: number;
  strokes: number;
  putts: number | null;
  fairway_hit: boolean | null;
  green_in_regulation: boolean | null;
  penalties: string[] | null;
}

export interface HoleWrite {
  hole_number: number;
  strokes: number;
  putts?: number | null;
  fairway_hit?: boolean | null;
  green_in_regulation?: boolean | null;
  /** Absent = leave the stored penalties alone; `[]` clears them. */
  penalties?: string[] | null;
  /** The version the client last saw for this hole; absent = unchecked. */
  expected_version?: number;
}

export interface HoleConflict {
  hole_number: number;
  /** The row as it stands now; null when the client expected a row that is gone. */
  current: HoleCurrent | null;
}

export interface HoleWritePlan {
  /** expected 0 and no row: insert. */
  inserts: HoleWrite[];
  /** expected n and the row is at n: update WHERE version = n. */
  updates: HoleWrite[];
  /** no expected_version: today's upsert. */
  unchecked: HoleWrite[];
  conflicts: HoleConflict[];
}

/**
 * `expected` undefined / null → never a conflict (unchecked). `expected 0`
 * conflicts when a row exists. `expected n` conflicts when the live
 * version differs — including when the row is gone (`current` null).
 */
export function detectHoleConflict(expected: number | null | undefined, current: number | null): boolean {
  if (expected === undefined || expected === null) return false;
  if (expected === 0) return current !== null;
  return current !== expected;
}

/** A non-negative integer, or undefined when absent; `null` = present but invalid (the route answers 400 by name). */
export function parseExpectedVersion(raw: unknown): number | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return null;
  return raw;
}

/** Split the requested writes by what the live rows allow. Pure; the server reads `currentByHole` first. */
export function planHoleWrites(scores: ReadonlyArray<HoleWrite>, currentByHole: ReadonlyMap<number, HoleCurrent>): HoleWritePlan {
  const plan: HoleWritePlan = { inserts: [], updates: [], unchecked: [], conflicts: [] };
  for (const s of scores) {
    const current = currentByHole.get(s.hole_number) ?? null;
    if (s.expected_version === undefined) {
      plan.unchecked.push(s);
      continue;
    }
    if (detectHoleConflict(s.expected_version, current?.version ?? null)) {
      plan.conflicts.push({ hole_number: s.hole_number, current });
      continue;
    }
    if (s.expected_version === 0) plan.inserts.push(s);
    else plan.updates.push(s);
  }
  return plan;
}

/** The row for an upsert / update: the five scored fields, `penalties` only when the write names it. */
export function holeRow(golfParticipantId: string, s: HoleWrite): Record<string, unknown> {
  const row: Record<string, unknown> = {
    golf_participant_id: golfParticipantId,
    hole_number: s.hole_number,
    strokes: s.strokes,
    putts: s.putts ?? null,
    fairway_hit: s.fairway_hit ?? null,
    green_in_regulation: s.green_in_regulation ?? null,
  };
  if (s.penalties !== undefined) row.penalties = s.penalties;
  return row;
}
