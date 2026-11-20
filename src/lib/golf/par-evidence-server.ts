import type { SupabaseClient } from '@supabase/supabase-js';
import { PAR_BOX_SOURCE, disputedHoles, judgePars, parCorrections, taggedMapPars, type HoleJudgement, type ParCorrection, type ParEvidenceRow } from '@/lib/golf/par-evidence';

/**
 * The one writer of `golf_par_evidence` (migration 317, Nov 20 2026): what a
 * source said a course's pars are, kept so the card can be re-judged without
 * asking a provider again (src/lib/golf/par-evidence.ts holds the rule).
 *
 * One source's rows for a course are REPLACED by its newest answer: a tee box
 * the provider no longer lists must not keep voting. Other sources' rows are
 * never touched. Never throws: keeping evidence must not fail a golfer's pick.
 */
export async function recordParEvidence(admin: SupabaseClient, courseId: string, rows: ReadonlyArray<ParEvidenceRow>): Promise<boolean> {
  if (rows.length === 0) return false;
  const sources = [...new Set(rows.map(r => r.source))];
  // One call records one source's answer; a mixed list would make "replace" ambiguous.
  if (sources.length !== 1) return false;
  const source = sources[0];
  const observed_at = new Date().toISOString();
  try {
    const { error } = await admin
      .from('golf_par_evidence')
      .upsert(rows.map(r => ({ course_id: courseId, source, label: r.label, votes: r.votes, pars: [...r.pars], observed_at })), { onConflict: 'course_id,source,label' });
    if (error) {
      // 42P01 / PGRST205: the table is not there yet (317 not run on this database).
      if (error.code !== '42P01' && error.code !== 'PGRST205') console.error(`[par-evidence] could not record ${source} for ${courseId}:`, error.message);
      return false;
    }
    // Labels this answer no longer carries are dropped (rows it just wrote carry the new stamp).
    const stale = await admin.from('golf_par_evidence').delete().eq('course_id', courseId).eq('source', source).lt('observed_at', observed_at);
    if (stale.error) console.error(`[par-evidence] could not clear old ${source} rows for ${courseId}:`, stale.error.message);
    return true;
  } catch (e) {
    console.error(`[par-evidence] could not record ${source} for ${courseId}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

/** Every source's rows for a course. Empty when there are none, or the table is not there. */
export async function readParEvidence(admin: SupabaseClient, courseId: string): Promise<ParEvidenceRow[]> {
  const { data, error } = await admin.from('golf_par_evidence').select('source, label, votes, pars').eq('course_id', courseId);
  if (error || !data) return [];
  return data.map(r => ({ source: r.source as ParEvidenceRow['source'], label: r.label as string, votes: r.votes as boolean, pars: (r.pars as Array<number | null>) ?? [] }));
}

// ── Settling (phase 2, Nov 20 2026) ──────────────────────────────────────────

/** Whether the app itself may correct a saved card when independent evidence
 *  settles a disputed hole. OFF while the first sweeps are read by a person:
 *  every caller on a golfer's path runs dry and only says what it would do.
 *  An admin's own decision on the console is not held back by this. */
export const PAR_SETTLE_WRITES = false;

export interface SettleResult {
  courseId: string;
  name: string;
  holes: number;
  /** What changed, or (dry) what would. */
  corrections: ParCorrection[];
  /** Holes still waiting for evidence or a person. */
  disputed: number[];
  judged: HoleJudgement[];
  applied: boolean;
  /** Why nothing was judged or written. */
  skipped?: 'no_card' | 'no_evidence' | 'changed_meanwhile' | 'write_failed';
}

interface SettleRow {
  id: string;
  name: string;
  total_par: number | null;
  hole_data: Array<{ number: number; par: number } & Record<string, unknown>> | null;
  sheet_sources: (Record<string, unknown> & { mapOverruled?: boolean; parsDisputed?: number[] }) | null;
  hole_geometry: { holes?: Array<{ hole: number; par?: number | null }> } | null;
}

/**
 * Judge one course's saved card against its evidence and correct what may be
 * corrected (par-evidence.ts: a hole settled by independent evidence, or
 * decided by an admin; never an agreed or a still-disputed hole).
 *
 * `allow` says which kinds this caller may WRITE: an admin's decisions only,
 * or settled holes too. `dryRun` writes nothing and reports the same result.
 * A correction changes that hole's par, the total and the list of disputed
 * holes, and nothing else on the card; each one is recorded in
 * `golf_par_changes`. The write is refused if the card's total moved since it
 * was read. A map the card overruled is not evidence against that card.
 */
export async function settleCoursePars(
  admin: SupabaseClient,
  courseId: string,
  opts: { dryRun?: boolean; allow?: ReadonlyArray<ParCorrection['reason']>; actor?: string; note?: string } = {}
): Promise<SettleResult | null> {
  const { data, error } = await admin.from('golf_courses').select('id, name, total_par, hole_data, sheet_sources, hole_geometry').eq('id', courseId).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as SettleRow;
  const saved = row.hole_data ?? [];
  const base = { courseId, name: row.name, holes: saved.length, corrections: [], disputed: [], judged: [], applied: false };
  if (saved.length === 0) return { ...base, skipped: 'no_card' };
  const evidence = await readParEvidence(admin, courseId);
  if (!evidence.some(e => e.source === PAR_BOX_SOURCE || e.source === 'admin')) return { ...base, skipped: 'no_evidence' };
  const mapPars = row.sheet_sources?.mapOverruled ? null : taggedMapPars(row.hole_geometry?.holes, saved.length);
  const judged = judgePars(evidence, mapPars, saved.length);
  const allow = opts.allow ?? ['admin', 'settled'];
  const corrections = parCorrections(saved, judged).filter(c => allow.includes(c.reason));
  const disputed = disputedHoles(judged);
  const result: SettleResult = { ...base, corrections, disputed, judged };
  if (opts.dryRun || corrections.length === 0) return result;

  const next = saved.map(h => {
    const fix = corrections.find(c => c.hole === h.number);
    return fix ? { ...h, par: fix.to } : h;
  });
  const sources = { ...(row.sheet_sources ?? {}) };
  if (disputed.length) sources.parsDisputed = disputed; else delete sources.parsDisputed;
  let write = admin.from('golf_courses').update({ hole_data: next, total_par: next.reduce((sum, h) => sum + h.par, 0), sheet_sources: sources }).eq('id', courseId);
  // Only the card that was judged: a total that moved meanwhile means someone else wrote it.
  write = row.total_par === null ? write.is('total_par', null) : write.eq('total_par', row.total_par);
  const done = await write.select('id');
  if (done.error) {
    console.error(`[par-evidence] could not correct ${courseId}:`, done.error.message);
    return { ...result, skipped: 'write_failed' };
  }
  if (!done.data?.length) return { ...result, skipped: 'changed_meanwhile' };
  const boxes = evidence.filter(e => e.source === PAR_BOX_SOURCE);
  const log = await admin.from('golf_par_changes').insert(corrections.map(c => {
    const j = judged[c.hole - 1];
    return {
      course_id: courseId,
      course_name: row.name.slice(0, 200),
      hole: c.hole,
      from_par: c.from,
      to_par: c.to,
      reason: c.reason,
      settled_by: c.settledBy.join('+').slice(0, 60) || null,
      actor: (opts.actor ?? 'system').slice(0, 200),
      note: opts.note?.slice(0, 500) ?? null,
      evidence: { boxes: Object.fromEntries(boxes.map(b => [b.label, b.pars[c.hole - 1] ?? null])), independent: j.independent, candidates: j.candidates },
    };
  }));
  // The card IS corrected; a record that failed to save is loud, never silent.
  if (log.error) console.error(`[par-evidence] ${courseId} "${row.name}" was corrected on hole ${corrections.map(c => c.hole).join(', ')} but the record could not be saved:`, log.error.message);
  for (const c of corrections) console.warn(`[par-evidence] ${courseId} "${row.name}" hole ${c.hole}: par ${c.from} → ${c.to} (${c.reason}${c.settledBy.length ? ` by ${c.settledBy.join(' + ')}` : ''})`);
  return { ...result, applied: true };
}

/** After evidence arrived on a golfer's path: settle what it settles. Dry
 *  while PAR_SETTLE_WRITES is off, saying what it would have changed. Never
 *  throws, and never an admin decision's concern (those write at once). */
export async function settleAfterEvidence(admin: SupabaseClient, courseId: string): Promise<void> {
  try {
    const r = await settleCoursePars(admin, courseId, { dryRun: !PAR_SETTLE_WRITES, allow: ['settled'] });
    if (r && !r.applied) for (const c of r.corrections) console.warn(`[par-evidence] dry: ${courseId} "${r.name}" hole ${c.hole} would go par ${c.from} → ${c.to} (settled by ${c.settledBy.join(' + ')})`);
  } catch (e) {
    console.error(`[par-evidence] settle after evidence failed for ${courseId}:`, e instanceof Error ? e.message : e);
  }
}

export interface ParSweep {
  dryRun: boolean;
  /** Courses that hold provider tee boxes as evidence. */
  courses: number;
  /** Courses with at least one correction (made, or dry: proposed). */
  changed: SettleResult[];
  /** Courses with holes still disputed and nothing to correct. */
  waiting: Array<{ courseId: string; name: string; disputed: number[] }>;
}

/** Every course with provider evidence, judged once. The admin door of phase
 *  2: dry unless asked otherwise AND PAR_SETTLE_WRITES is on. */
export async function sweepParSettlement(admin: SupabaseClient, opts: { dryRun?: boolean; limit?: number } = {}): Promise<ParSweep> {
  const dryRun = opts.dryRun !== false || !PAR_SETTLE_WRITES;
  const { data, error } = await admin.from('golf_par_evidence').select('course_id').eq('source', PAR_BOX_SOURCE).limit(20000);
  if (error) throw new Error(error.message);
  const ids = [...new Set((data ?? []).map(r => r.course_id as string))].slice(0, opts.limit ?? 2000);
  const sweep: ParSweep = { dryRun, courses: ids.length, changed: [], waiting: [] };
  for (const id of ids) {
    const r = await settleCoursePars(admin, id, { dryRun, allow: ['settled'], actor: 'system' });
    if (!r || r.skipped === 'no_card' || r.skipped === 'no_evidence') continue;
    if (r.corrections.length) sweep.changed.push(r);
    else if (r.disputed.length) sweep.waiting.push({ courseId: r.courseId, name: r.name, disputed: r.disputed });
  }
  return sweep;
}
