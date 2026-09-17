/**
 * The stat round's completion mirror (Events program, phase 4) — the
 * `mirrorCompletedRound` posture: idempotent, best-effort, awaited. Per
 * fielded player with ≥ 1 finite stat and not hidden: upsert ONE posts row
 * found by `stats_data->>'sport_event_stat_line_id'`; then the performance
 * row through `fromStatLinePost` (the origin IS the post) with the event's
 * provenance as the overlay; then the round's ONE post flips to
 * `sport_event_results` + the created_at bump. The opt-out's late flip:
 * hidden → the mirrored post and its performance row go; shown → re-mirror.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { fromStatLinePost } from '@/lib/performance/map';
import { naturalKey } from '@/lib/performance/types';
import { deletePerformancesByKeys, upsertPerformances } from '@/lib/performance/write-server';
import { readFormatConfig, readGameConfig } from './format-config';
import { sideNamesOf } from './game';
import { lineHasStats, provenanceForLine, resultsPostData, statLinePostRow, type ResultLineInput } from './stat-results';
import { scoreOf, STAT_LINE_COLUMNS, type StatLineRow } from './stats-server';
import { shapeOf, type SportEventRoundRow, type SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const POST_SELECT = 'id, profile_id, sport_key, stats_data, status, created_at';

async function hiddenProfileIdsForEvent(admin: Admin, eventId: string): Promise<Set<string>> {
  const { data } = await admin.from('sport_event_participants').select('profile_id').eq('sport_event_id', eventId).eq('hide_from_profile', true);
  return new Set(((data ?? []) as Array<{ profile_id: string }>).map(r => r.profile_id));
}

export async function readResultLines(admin: Admin, event: SportEventRow, round: SportEventRoundRow): Promise<ResultLineInput[]> {
  const [{ data: lineRows }, { data: memberRows }, { data: partRows }] = await Promise.all([
    admin.from('sport_event_stat_lines').select(STAT_LINE_COLUMNS).eq('sport_event_round_id', round.id),
    admin.from('sport_event_group_members').select('participant_id, side').eq('sport_event_round_id', round.id),
    admin.from('sport_event_participants').select('id, status').eq('sport_event_id', event.id),
  ]);
  const active = new Set(((partRows ?? []) as Array<{ id: string; status: string }>).filter(p => p.status === 'accepted').map(p => p.id));
  const lines = ((lineRows ?? []) as StatLineRow[]).filter(l => active.has(l.participant_id));
  const sideOf = new Map<string, 1 | 2 | null>(((memberRows ?? []) as Array<{ participant_id: string; side: number | null }>).map(m => [m.participant_id, m.side === 1 ? 1 : m.side === 2 ? 2 : null]));
  const ids = [...new Set(lines.map(l => l.profile_id))];
  const { data: profs } = ids.length > 0 ? await admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle').in('id', ids) : { data: [] };
  const nameOf = new Map(((profs ?? []) as Array<MaskableProfile & { id: string }>).map(p => [p.id, publicDisplayName(p)]));
  return lines.map(l => ({ id: l.id, participant_id: l.participant_id, profile_id: l.profile_id, stats: l.stats ?? {}, side: sideOf.get(l.participant_id) ?? null, name: nameOf.get(l.profile_id) ?? 'Athlete', entered_by: l.entered_by }));
}

async function findMirroredPost(admin: Admin, lineId: string): Promise<{ id: string } | null> {
  const { data } = await admin.from('posts').select('id').eq('stats_data->>sport_event_stat_line_id', lineId).limit(1).maybeSingle();
  return (data as { id: string } | null) ?? null;
}

/** Remove one line's mirrored post and its performance row (the opt-out, or a line emptied before completion). */
export async function unmirrorLine(admin: Admin, lineId: string): Promise<void> {
  const post = await findMirroredPost(admin, lineId);
  if (!post) return;
  await deletePerformancesByKeys(admin, [naturalKey.post(post.id)]);
  const { error } = await admin.from('posts').delete().eq('id', post.id);
  if (error) console.error('[sport-events stat results] mirrored post delete failed:', error);
}

/** The whole round: every line's post + performance row, then the round's results post. Idempotent. */
export async function mirrorStatRound(admin: Admin, event: SportEventRow, round: SportEventRoundRow & { announce_post_id?: string | null }): Promise<void> {
  try {
    const shape = shapeOf(event);
    if (shape === 'round') return;
    const lines = await readResultLines(admin, event, round);
    const hidden = await hiddenProfileIdsForEvent(admin, event.id);
    const game = shape === 'game' ? { score: scoreOf(round), sides: sideNamesOf(readGameConfig(readFormatConfig(event.format_config, 8, event.format, shape), shape)) } : null;
    const createdBy = event.created_by_user_id && event.created_by_user_id !== event.host_profile_id ? event.created_by_user_id : null;

    for (const line of lines) {
      if (hidden.has(line.profile_id) || !lineHasStats(line.stats)) {
        await unmirrorLine(admin, line.id);
        continue;
      }
      const row = statLinePostRow(event, round, line, game, createdBy);
      const existing = await findMirroredPost(admin, line.id);
      let postId = existing?.id ?? null;
      if (postId) {
        const { error } = await admin.from('posts').update({ stats_data: row.stats_data, caption: row.caption, visibility: row.visibility }).eq('id', postId);
        if (error) { console.error('[sport-events stat results] post update failed:', error); continue; }
      } else {
        const { data: inserted, error } = await admin.from('posts').insert(row).select('id').single();
        if (error || !inserted) { console.error('[sport-events stat results] post insert failed:', error); continue; }
        postId = inserted.id as string;
      }
      const { data: post } = await admin.from('posts').select(POST_SELECT).eq('id', postId).maybeSingle();
      if (!post) continue;
      const perf = fromStatLinePost(post as { id: string; profile_id: string; sport_key: string; stats_data: unknown; status: string; created_at: string });
      if (perf) {
        const overlay = { provenance: provenanceForLine(event, line), entered_by: line.entered_by, context: { ...(perf.context ?? {}), sport_event_id: event.id, sport_event_round_id: round.id, shape, recorder: !!line.entered_by && line.entered_by !== line.profile_id } };
        await upsertPerformances(admin, [{ ...perf, ...overlay }]);
      }
    }

    // The round's ONE post → the results (the score, the sides, the top lines) + the feed bump.
    const { data: roundPost } = await admin.from('posts').select('id').eq('sport_event_round_id', round.id).maybeSingle();
    if (roundPost?.id) {
      const results = resultsPostData(event, round, shape, lines.filter(l => !hidden.has(l.profile_id)), game);
      const { error } = await admin.from('posts').update({ stats_data: results, created_at: new Date().toISOString() }).eq('id', roundPost.id);
      if (error) console.error('[sport-events stat results] round post flip failed:', error);
    }
  } catch (e) {
    console.error('[sport-events stat results] mirror failed:', e);
  }
}

/** The opt-out on a stat event: hidden → every mirrored line of this profile goes; shown → every completed round re-mirrors. */
export async function applyStatOptOut(admin: Admin, event: SportEventRow, rounds: ReadonlyArray<SportEventRoundRow>, profileId: string, hidden: boolean): Promise<void> {
  for (const round of rounds) {
    if (round.status !== 'completed') continue;
    if (!hidden) { await mirrorStatRound(admin, event, round); continue; }
    const { data: lines } = await admin.from('sport_event_stat_lines').select('id').eq('sport_event_round_id', round.id).eq('profile_id', profileId);
    for (const l of (lines ?? []) as Array<{ id: string }>) await unmirrorLine(admin, l.id);
  }
}
