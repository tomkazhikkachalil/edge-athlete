import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParEvidenceRow } from '@/lib/golf/par-evidence';

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
