/**
 * Per-hole compare-and-set — the I/O half (Events program, phase 2b, B3;
 * migration 209). ONE writer of `golf_hole_scores` for both score routes.
 *
 * `writeHoleScores` reads the live rows once (only when some write is
 * checked), plans through `planHoleWrites`, then: unchecked writes go
 * through today's upsert (last writer wins — old clients, the solo modal,
 * the composer); an INSERT (`expected 0`) that meets a row (23505) is a
 * conflict; an UPDATE runs `WHERE version = expected` and 0 rows is a
 * conflict. A conflict carries the hole's CURRENT row (re-read after the
 * write attempt) so the client can show it and resend with its version.
 * Writes that were not in conflict are written — the outbox sends one
 * hole per request, so a partial batch is the bulk path's concern only,
 * and it reports `written` beside `conflicts`.
 *
 * The 039 totals trigger still bumps the card on every write — that is
 * what `useSharedRound`'s Realtime subscription listens to. Do not touch.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { holeRow, planHoleWrites, type HoleConflict, type HoleCurrent, type HoleWrite } from './hole-writes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public', any>;

const CURRENT_SELECT = 'hole_number, strokes, putts, fairway_hit, green_in_regulation, penalties, version';

export async function readCurrentHoles(db: Db, golfParticipantId: string, holeNumbers?: ReadonlyArray<number>): Promise<Map<number, HoleCurrent>> {
  let q = db.from('golf_hole_scores').select(CURRENT_SELECT).eq('golf_participant_id', golfParticipantId);
  if (holeNumbers && holeNumbers.length > 0) q = q.in('hole_number', [...holeNumbers]);
  const { data, error } = await q;
  if (error) throw error;
  const out = new Map<number, HoleCurrent>();
  for (const r of (data ?? []) as Array<HoleCurrent & { hole_number: number }>) {
    out.set(r.hole_number, { version: r.version, strokes: r.strokes, putts: r.putts, fairway_hit: r.fairway_hit, green_in_regulation: r.green_in_regulation, penalties: r.penalties });
  }
  return out;
}

export interface HoleWriteOutcome {
  written: number;
  conflicts: HoleConflict[];
  /** A database error other than a conflict; the route answers 500. */
  error: string | null;
}

export async function writeHoleScores(db: Db, golfParticipantId: string, scores: ReadonlyArray<HoleWrite>): Promise<HoleWriteOutcome> {
  const checked = scores.some(s => s.expected_version !== undefined);
  let current = new Map<number, HoleCurrent>();
  if (checked) {
    try {
      current = await readCurrentHoles(db, golfParticipantId, scores.map(s => s.hole_number));
    } catch (e) {
      console.error('[hole-scores] current read failed:', e);
      return { written: 0, conflicts: [], error: 'Failed to read hole scores' };
    }
  }
  const plan = planHoleWrites(scores, current);
  const conflicts: HoleConflict[] = [...plan.conflicts];
  let written = 0;

  // PostgREST refuses a bulk payload whose rows differ in keys, and a row
  // omits `penalties` on purpose (leave them alone) — so one upsert per
  // key shape. The upsert's DO UPDATE sets only the payload's columns.
  const shapes = [plan.unchecked.filter(s => s.penalties !== undefined), plan.unchecked.filter(s => s.penalties === undefined)];
  for (const batch of shapes) {
    if (batch.length === 0) continue;
    const { error } = await db.from('golf_hole_scores').upsert(batch.map(s => holeRow(golfParticipantId, s)), { onConflict: 'golf_participant_id,hole_number' });
    if (error) {
      console.error('[hole-scores] upsert failed:', error);
      return { written, conflicts, error: 'Failed to save hole scores' };
    }
    written += batch.length;
  }

  const raced: number[] = [];
  for (const s of plan.inserts) {
    const { error } = await db.from('golf_hole_scores').insert(holeRow(golfParticipantId, s));
    if (error?.code === '23505') {
      raced.push(s.hole_number);
      continue;
    }
    if (error) {
      console.error('[hole-scores] insert failed:', error);
      return { written, conflicts, error: 'Failed to save hole scores' };
    }
    written += 1;
  }

  for (const s of plan.updates) {
    const row = holeRow(golfParticipantId, s);
    delete row.golf_participant_id;
    delete row.hole_number;
    const { data, error } = await db
      .from('golf_hole_scores')
      .update(row)
      .eq('golf_participant_id', golfParticipantId)
      .eq('hole_number', s.hole_number)
      .eq('version', s.expected_version as number)
      .select('hole_number');
    if (error) {
      console.error('[hole-scores] update failed:', error);
      return { written, conflicts, error: 'Failed to save hole scores' };
    }
    if ((data ?? []).length === 0) raced.push(s.hole_number);
    else written += 1;
  }

  if (raced.length > 0) {
    // Someone landed between the plan and the write: report what is there now.
    try {
      const now = await readCurrentHoles(db, golfParticipantId, raced);
      for (const hole of raced) conflicts.push({ hole_number: hole, current: now.get(hole) ?? null });
    } catch {
      for (const hole of raced) conflicts.push({ hole_number: hole, current: null });
    }
  }
  return { written, conflicts, error: null };
}
