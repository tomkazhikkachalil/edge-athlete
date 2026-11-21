import type { SupabaseClient } from '@supabase/supabase-js';
import { estimatePar } from '@/lib/golf/map-sheet';
import { PAR_BOX_SOURCE, judgePars, judgementCounts, lengthVotes, openHoles, parCorrections, taggedMapPars, type HoleJudgement, type ParCorrection, type ParEvidenceRow } from '@/lib/golf/par-evidence';

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

/** Whether the app itself may correct a saved card when a strong source
 *  settles a hole its tees disagree on. ON since Nov 20 2026 (Tom: "yes to
 *  both, go ahead", after the dry list on production was read: 39 cards, no
 *  correction proposed). Every correction is one hole, to a par a tee gave,
 *  logged in golf_par_changes and shown on the admin console. An admin's own
 *  decision always wins and was never held back by this. */
export const PAR_SETTLE_WRITES = true;

export interface SettleResult {
  courseId: string;
  name: string;
  holes: number;
  /** What changed, or (dry) what would. */
  corrections: ParCorrection[];
  /** Holes waiting for a person: impossible data, or a settled correction not yet written. */
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
  hole_data: Array<{ number: number; par: number; yardage?: unknown } & Record<string, unknown>> | null;
  sheet_sources: (Record<string, unknown> & { mapOverruled?: boolean; parsDisputed?: number[] }) | null;
  hole_geometry: { holes?: Array<{ hole: number; par?: number | null }> } | null;
}

/** A saved card judged against its evidence and its own tagged map pars. A
 *  map the card overruled is not evidence against that card. In memory: the
 *  one judgement both a single course and the whole review list go through. */
export function judgeSavedCard(row: Pick<SettleRow, 'hole_data' | 'sheet_sources' | 'hole_geometry'>, evidence: ReadonlyArray<ParEvidenceRow>): HoleJudgement[] {
  const holes = row.hole_data?.length ?? 0;
  const mapPars = row.sheet_sources?.mapOverruled ? null : taggedMapPars(row.hole_geometry?.holes, holes);
  // The card's own lengths by tee: what makes a tee's par impossible, which
  // tees are the longest, and the hole's length as one weak vote.
  const yards = (row.hole_data ?? []).map(h => (h.yardage && typeof h.yardage === 'object' ? (h.yardage as Record<string, unknown>) : null));
  const men = evidence.filter(e => e.source === PAR_BOX_SOURCE && e.votes).map(e => e.label);
  return judgePars(evidence, mapPars, holes, { yards, lengthPars: lengthVotes(yards, men, estimatePar) });
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
  const judged = judgeSavedCard(row, evidence);
  const allow = opts.allow ?? ['admin', 'settled'];
  const corrections = parCorrections(saved, judged).filter(c => allow.includes(c.reason));
  // What is open on the card as it stands, and what will be once these corrections are written.
  const afterWrite = saved.map(h => ({ number: h.number, par: corrections.find(c => c.hole === h.number)?.to ?? h.par }));
  const result: SettleResult = { ...base, corrections, disputed: openHoles(saved, judged), judged };
  if (opts.dryRun || corrections.length === 0) return result;
  const disputed = openHoles(afterWrite, judged);

  const next = saved.map(h => {
    const fix = corrections.find(c => c.hole === h.number);
    return fix ? { ...h, par: fix.to } : h;
  });
  const sources = { ...(row.sheet_sources ?? {}) };
  if (disputed.length) sources.parsDisputed = disputed; else delete sources.parsDisputed;
  // Only the card that was judged. The total guards the write itself; the pars
  // are read once more first, because two holes moved in opposite directions
  // leave the total where it was.
  const again = await admin.from('golf_courses').select('id, name, total_par, hole_data, sheet_sources, hole_geometry').eq('id', courseId).maybeSingle();
  const now = (again.data as unknown as SettleRow | null)?.hole_data ?? [];
  if (again.error || now.length !== saved.length || now.some((h, i) => h.number !== saved[i].number || h.par !== saved[i].par)) return { ...result, skipped: 'changed_meanwhile' };
  let write = admin.from('golf_courses').update({ hole_data: next, total_par: next.reduce((sum, h) => sum + h.par, 0), sheet_sources: sources }).eq('id', courseId);
  // A total that moved meanwhile means someone else wrote it.
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
  return { ...result, disputed, applied: true };
}

/** After evidence arrived on a golfer's path: settle what it settles. Dry
 *  while PAR_SETTLE_WRITES is off, saying what it would have changed. Never
 *  throws, and never an admin decision's concern (those write at once). */
// (PAR_SETTLE_WRITES is on: this writes.)
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

// ── The review list and an admin's decision (phase 3, Nov 20 2026) ───────────

export interface ParReviewHole {
  hole: number;
  /** The par on the saved card. */
  saved: number;
  /** What each of the provider's tee boxes says, by box. */
  boxes: Record<string, number | null>;
  /** The hole's length from each tee on the saved card, in yards, by tee (the
   *  same names as `boxes`): what tells a person whether a par makes sense. */
  yards: Record<string, number>;
  /** What the independent sources say ('map', 'website', 'opengolfapi'). */
  independent: Record<string, number>;
  /** The choices offered, lowest first: every believable par a box gave; for
   *  a hole no box is believable on, what the boxes say and what its length suggests. */
  candidates: number[];
  /** Why it waits: no tee gives a par its length allows, or the confirmations
   *  settled a par that is not written yet. */
  why: 'impossible' | 'unwritten';
  /** The par the confirmations settled on (why `unwritten`). */
  settled: number | null;
}

/** The pars a person may choose for a hole without a note: what a believable
 *  box gave, what any other source said, and for an impossible hole what the
 *  boxes say as they stand and what the hole's longest tee suggests. */
function holeChoices(saved: SettleRow['hole_data'], evidence: ReadonlyArray<ParEvidenceRow>, judged: HoleJudgement): number[] {
  const out = new Set<number>([...judged.candidates, ...Object.values(judged.independent)]);
  if (judged.status === 'impossible') {
    const h = judged.hole - 1;
    for (const b of evidence) if (b.source === PAR_BOX_SOURCE && typeof b.pars[h] === 'number') out.add(b.pars[h] as number);
    const lengths = Object.values((saved?.[h]?.yardage as Record<string, unknown> | undefined) ?? {}).filter((y): y is number => typeof y === 'number' && y > 0);
    if (lengths.length) out.add(estimatePar(Math.max(...lengths)));
  }
  return [...out].filter(p => Number.isInteger(p) && p >= 3 && p <= 6).sort((a, b) => a - b);
}
export interface ParReviewCourse {
  courseId: string;
  name: string;
  city: string | null;
  region: string | null;
  picks: number;
  holes: ParReviewHole[];
}
export interface ParReviewChange {
  id: string;
  courseName: string;
  hole: number;
  fromPar: number;
  toPar: number;
  reason: string;
  settledBy: string | null;
  actor: string;
  note: string | null;
  changedAt: string;
}
export interface ParReview {
  /** Courses with holes waiting for a person, most picked first. */
  courses: ParReviewCourse[];
  /** The last changes made to a saved par, newest first. */
  changes: ParReviewChange[];
  /** Courses that hold provider tee boxes at all. */
  judged: number;
  /** Holes whose tees disagreed, by how they were decided, over every judged
   *  card: confirmed by other sources (or an admin), decided by the rule
   *  alone, and impossible (the ones listed). */
  counts: { confirmed: number; byRule: number; impossible: number };
}

/** How many course rows one read of the review list asks for (each carries its map lines). */
const REVIEW_CHUNK = 25;

/** What the admin console shows: every saved card with holes still open
 *  (openHoles), most-picked course first, and the last recorded changes.
 *
 *  Read in a handful of queries however many courses hold evidence: ALL the
 *  evidence at once, the course rows in chunks, the pick counts once. The
 *  first version judged each course with its own five reads (93 reads and
 *  five seconds for 39 courses on production, Nov 20 2026), and the console
 *  re-read the list after every tap. */
export async function readParReview(admin: SupabaseClient): Promise<ParReview> {
  const { data, error } = await admin.from('golf_par_evidence').select('course_id, source, label, votes, pars').limit(50000);
  if (error) throw new Error(error.message);
  const byCourse = new Map<string, ParEvidenceRow[]>();
  for (const r of data ?? []) {
    const list = byCourse.get(r.course_id as string) ?? [];
    list.push({ source: r.source as ParEvidenceRow['source'], label: r.label as string, votes: r.votes as boolean, pars: (r.pars as Array<number | null>) ?? [] });
    byCourse.set(r.course_id as string, list);
  }
  const ids = [...byCourse.entries()].filter(([, rows]) => rows.some(e => e.source === PAR_BOX_SOURCE)).map(([id]) => id).slice(0, 2000);
  const courses: ParReviewCourse[] = [];
  const counts = { confirmed: 0, byRule: 0, impossible: 0 };
  for (let i = 0; i < ids.length; i += REVIEW_CHUNK) {
    const chunk = await admin.from('golf_courses').select('id, name, city, region, total_par, hole_data, sheet_sources, hole_geometry').in('id', ids.slice(i, i + REVIEW_CHUNK));
    if (chunk.error) throw new Error(chunk.error.message);
    for (const raw of chunk.data ?? []) {
      const row = raw as unknown as SettleRow & { city: string | null; region: string | null };
      const saved = row.hole_data ?? [];
      if (saved.length === 0) continue;
      const evidence = byCourse.get(row.id) ?? [];
      const judged = judgeSavedCard(row, evidence);
      const tally = judgementCounts(judged);
      counts.confirmed += tally.confirmed;
      counts.byRule += tally.byRule;
      counts.impossible += tally.impossible;
      const open = openHoles(saved, judged);
      if (open.length === 0) continue;
      const boxes = evidence.filter(e => e.source === PAR_BOX_SOURCE);
      courses.push({
        courseId: row.id,
        name: row.name,
        city: row.city ?? null,
        region: row.region ?? null,
        picks: 0,
        holes: open.map(hole => ({
          hole,
          saved: saved.find(h => h.number === hole)?.par ?? 0,
          boxes: Object.fromEntries(boxes.map(b => [b.label, b.pars[hole - 1] ?? null])),
          yards: Object.fromEntries(Object.entries((saved.find(h => h.number === hole)?.yardage as Record<string, unknown> | undefined) ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)),
          independent: judged[hole - 1].independent,
          candidates: holeChoices(saved, evidence, judged[hole - 1]),
          why: judged[hole - 1].status === 'impossible' ? 'impossible' as const : 'unwritten' as const,
          settled: judged[hole - 1].status === 'settled' ? judged[hole - 1].par : null,
        })),
      });
    }
  }
  if (courses.length) {
    const picks = await admin.from('golf_course_picks').select('course_id, picks').in('course_id', courses.map(c => c.courseId));
    for (const p of picks.data ?? []) {
      const c = courses.find(x => x.courseId === (p.course_id as string));
      if (c) c.picks = (p.picks as number) ?? 0;
    }
  }
  courses.sort((a, b) => b.picks - a.picks || a.name.localeCompare(b.name));
  const log = await admin.from('golf_par_changes').select('id, course_name, hole, from_par, to_par, reason, settled_by, actor, note, changed_at').order('changed_at', { ascending: false }).limit(20);
  if (log.error) throw new Error(log.error.message);
  return {
    courses,
    judged: ids.length,
    counts,
    changes: (log.data ?? []).map(c => ({ id: c.id as string, courseName: c.course_name as string, hole: c.hole as number, fromPar: c.from_par as number, toPar: c.to_par as number, reason: c.reason as string, settledBy: (c.settled_by as string | null) ?? null, actor: c.actor as string, note: (c.note as string | null) ?? null, changedAt: c.changed_at as string })),
  };
}

export type ParDecision =
  | { ok: true; changed: boolean; result: SettleResult }
  | { ok: false; error: 'not_found' | 'no_card' | 'bad_hole' | 'bad_par' | 'note_required' | 'write_failed' };

/**
 * An admin decides one hole's par on the console. The decision is kept as an
 * `admin` evidence row (so it holds against every later judgement) and the
 * saved card is corrected at once, recorded with who decided. Choosing the
 * par the card already has closes the hole without changing anything.
 * A par no source gave needs a note saying where it comes from.
 */
export async function decideHolePar(admin: SupabaseClient, input: { courseId: string; hole: number; par: number; actor: string; note?: string | null }): Promise<ParDecision> {
  const { courseId, hole, par } = input;
  if (!Number.isInteger(par) || par < 3 || par > 6) return { ok: false, error: 'bad_par' };
  const before = await settleCoursePars(admin, courseId, { dryRun: true });
  if (!before) return { ok: false, error: 'not_found' };
  if (before.holes === 0) return { ok: false, error: 'no_card' };
  if (!Number.isInteger(hole) || hole < 1 || hole > before.holes) return { ok: false, error: 'bad_hole' };
  const note = input.note?.trim() || null;
  const judged = before.judged[hole - 1];
  // One admin row per course: this hole's decision joins the ones already made.
  const evidence = await readParEvidence(admin, courseId);
  const card = await admin.from('golf_courses').select('hole_data').eq('id', courseId).maybeSingle();
  const known = new Set(judged ? holeChoices(((card.data as { hole_data?: SettleRow['hole_data'] } | null)?.hole_data) ?? null, evidence, judged) : []);
  if (!known.has(par) && !note) return { ok: false, error: 'note_required' };
  const decided: Array<number | null> = Array.from({ length: before.holes }, (_, i) => evidence.filter(e => e.source === 'admin').map(e => e.pars[i]).filter((p): p is number => typeof p === 'number').pop() ?? null);
  decided[hole - 1] = par;
  if (!(await recordParEvidence(admin, courseId, [{ source: 'admin', label: '', votes: false, pars: decided }]))) return { ok: false, error: 'write_failed' };
  const result = await settleCoursePars(admin, courseId, { allow: ['admin'], actor: input.actor, note: note ?? undefined });
  if (!result || result.skipped === 'write_failed' || result.skipped === 'changed_meanwhile') return { ok: false, error: 'write_failed' };
  return { ok: true, changed: result.applied, result };
}
