// ── History's reader (server): one keyset page over workouts AND activities ──
// Training redesign PR 4 (Nov 11 2026). Admin client; the ROUTE decides who
// may read (resolveActivityAccess + the Training privacy aspect). Here: which
// ROWS that audience receives, and the page.
//   * workouts — completed only; a non-owner never receives one the owner hid
//     (269) or has not decided (Post or Done not reached — their draft);
//   * activities — "Only me" is the owner's; everything else is projected for
//     the audience (visibility.ts), as the activities list does.
// Both tables are read past the SAME cursor (started_at, then id), a page + 1
// each, and merged (history.ts) — so "Load more" never skips or repeats a row
// and never reads more than two pages to show one.

import type { SupabaseClient } from '@supabase/supabase-js';
import { encodeCursor } from '@/lib/activities/read-server';
import { ACTIVITY_COLUMNS, projectActivity, type ActivityAudience, type ActivityRow, type ActivityView } from '@/lib/activities/visibility';
import { proxyWorkoutMedia, sortNestedWorkouts, WORKOUT_SESSION_SELECT } from '@/lib/workouts/read-server';
import type { ServerWorkoutSession } from '@/lib/workouts/serialize';
import { HISTORY_PAGE, mergeHistoryPage, type HistoryKind } from './history';

export type HistoryEntry =
  | { kind: 'workout'; id: string; startedAt: string; session: ServerWorkoutSession }
  | { kind: 'activity'; id: string; startedAt: string; activity: ActivityView };

export interface HistoryCursor {
  startedAt: string;
  id: string;
}

/** The cursor's filter, the same spelling listActivities uses (the values are a strict ISO timestamp and a uuid — decodeCursor admits nothing else). */
const past = (c: HistoryCursor) => `started_at.lt."${c.startedAt}",and(started_at.eq."${c.startedAt}",id.lt.${c.id})`;

async function readWorkouts(admin: SupabaseClient, profileId: string, isOwner: boolean, cursor: HistoryCursor | null): Promise<HistoryEntry[] | null> {
  let q = admin
    .from('workout_sessions')
    .select(WORKOUT_SESSION_SELECT)
    .eq('profile_id', profileId)
    .eq('status', 'completed')
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE + 1);
  if (!isOwner) q = q.is('profile_hidden_at', null).not('share_decided_at', 'is', null);
  if (cursor) q = q.or(past(cursor)); // hardening-ok: decodeCursor admits a strict ISO timestamp + a uuid only
  const { data, error } = await q;
  if (error) {
    console.error('[training/history] workouts read failed:', error.message);
    return null;
  }
  const rows = (data ?? []) as unknown as ServerWorkoutSession[];
  sortNestedWorkouts(rows as unknown as Parameters<typeof sortNestedWorkouts>[0]);
  proxyWorkoutMedia(rows as unknown as Parameters<typeof proxyWorkoutMedia>[0], profileId);
  return rows.map(session => ({ kind: 'workout' as const, id: session.id, startedAt: session.started_at, session }));
}

async function readActivities(admin: SupabaseClient, profileId: string, audience: ActivityAudience, cursor: HistoryCursor | null): Promise<HistoryEntry[] | null> {
  let q = admin
    .from('activities')
    .select(ACTIVITY_COLUMNS)
    .eq('profile_id', profileId)
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE + 1);
  if (audience !== 'owner') q = q.eq('only_me', false);
  if (cursor) q = q.or(past(cursor)); // hardening-ok: decodeCursor admits a strict ISO timestamp + a uuid only
  const { data, error } = await q;
  if (error) {
    console.error('[training/history] activities read failed:', error.message);
    return null;
  }
  return ((data ?? []) as unknown as ActivityRow[]).map(row => ({ kind: 'activity' as const, id: row.id, startedAt: row.started_at, activity: projectActivity(row, audience) }));
}

/** One page of History for this audience: newest first, `next` when there is more. */
export async function listTrainingHistory(
  admin: SupabaseClient,
  profileId: string,
  audience: ActivityAudience,
  kind: HistoryKind,
  cursor: HistoryCursor | null
): Promise<{ ok: true; items: HistoryEntry[]; next: string | null } | { ok: false }> {
  const [workouts, activities] = await Promise.all([
    kind === 'activities' ? Promise.resolve<HistoryEntry[]>([]) : readWorkouts(admin, profileId, audience === 'owner', cursor),
    kind === 'workouts' ? Promise.resolve<HistoryEntry[]>([]) : readActivities(admin, profileId, audience, cursor),
  ]);
  if (!workouts || !activities) return { ok: false };
  const { items, more } = mergeHistoryPage<HistoryEntry>([workouts, activities]);
  const last = items[items.length - 1];
  return { ok: true, items, next: more && last ? encodeCursor({ started_at: last.startedAt, id: last.id }) : null };
}
