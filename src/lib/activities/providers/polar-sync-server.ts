// ── Polar → activities (fix round part 3, PR 4) — SERVER ONLY ───────────────
// One exercise, however we learned of it (the webhook, the first sync after
// connecting, the daily net under a missed webhook), goes the same way:
// its FIT → parseFit → the ONE writer, as `source: 'polar'` with Polar's own
// exercise id. No FIT (a session with no samples) → the summary's bare
// activity. A 401 from Polar means the athlete withdrew consent there: the
// connection is marked revoked and nothing more is asked of Polar.

import type { SupabaseClient } from '@supabase/supabase-js';
import { activeWriterRefusal } from '@/lib/auth-server';
import { isSupervisedProfile, listActiveConnections, markRevoked, recordDelivery, type ProviderConnection } from '../connections-server';
import { parseFit } from '../parse-fit-server';
import type { NormalizedActivity } from '../types';
import { importActivity } from '../write-server';
import { polarSummaryToActivity } from './polar';
import { polarConfig, polarExerciseFit, polarExerciseSummary, polarListExercises, type PolarConfig } from './polar-server';

type Admin = SupabaseClient;

export type ExerciseOutcome = 'imported' | 'duplicate' | 'refused' | 'failed' | 'unauthorized';

/**
 * Whether this account may receive a delivery NOW. A connection outlives the
 * moment it was made: an account that has since become supervised, or that
 * moderation holds, gets nothing (the upload link's two refusals) — the
 * connection stays, and deliveries resume when the account may write again.
 */
export async function mayReceive(admin: Admin, profileId: string): Promise<boolean> {
  if (await isSupervisedProfile(admin, profileId)) return false;
  return (await activeWriterRefusal(profileId)) === null;
}

export async function importPolarExercise(admin: Admin, cfg: PolarConfig, conn: ProviderConnection, exerciseId: string): Promise<ExerciseOutcome> {
  if (!conn.secret) return 'failed';
  if (!(await mayReceive(admin, conn.profileId))) return 'refused';
  const token = conn.secret.accessToken;

  let activity: NormalizedActivity | null = null;
  const fit = await polarExerciseFit(cfg, token, exerciseId);
  if (!fit.ok) return fit.unauthorized ? 'unauthorized' : 'failed';
  if (fit.value) {
    try {
      activity = parseFit(fit.value);
    } catch {
      activity = null; // an unreadable FIT falls through to the summary
    }
  }
  if (!activity) {
    const summary = await polarExerciseSummary(cfg, token, exerciseId);
    if (!summary.ok) return summary.unauthorized ? 'unauthorized' : 'failed';
    activity = polarSummaryToActivity(summary.value);
    if (!activity) return 'refused';
  }

  const outcome = await importActivity(admin, conn.profileId, activity, { timeZone: null, source: 'polar', externalId: exerciseId });
  if (!outcome.ok) return outcome.status === 500 ? 'failed' : 'refused';
  return outcome.duplicate ? 'duplicate' : 'imported';
}

export interface SyncSummary {
  imported: number;
  duplicates: number;
  refused: number;
  failed: number;
  revoked: boolean;
}

/**
 * Everything of the last 30 days this athlete does not have yet, newest
 * first, at most `max` per run (the rest come on the next run). The ids
 * already imported from Polar are read first, so a daily run costs one list
 * call per athlete and no downloads when nothing is new.
 */
export async function syncPolarConnection(admin: Admin, cfg: PolarConfig, conn: ProviderConnection, max: number): Promise<SyncSummary> {
  const out: SyncSummary = { imported: 0, duplicates: 0, refused: 0, failed: 0, revoked: false };
  if (!conn.secret) {
    out.failed = 1;
    return out;
  }
  // Nothing is even asked of Polar for an account that may not receive.
  if (!(await mayReceive(admin, conn.profileId))) return out;
  const list = await polarListExercises(cfg, conn.secret.accessToken);
  if (!list.ok) {
    if (list.unauthorized) {
      await markRevoked(admin, conn.id);
      out.revoked = true;
    } else {
      out.failed = 1;
      await recordDelivery(admin, conn.id, { ok: false, error: 'Polar did not answer. It is retried every day.' });
    }
    return out;
  }

  const ids = list.value.map(e => e.id);
  const have = new Set<string>();
  if (ids.length > 0) {
    const { data } = await admin.from('activities').select('external_id').eq('profile_id', conn.profileId).eq('source', 'polar').in('external_id', ids);
    for (const row of data ?? []) have.add(row.external_id as string);
  }
  const fresh = list.value
    .filter(e => !have.has(e.id))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, max);

  for (const e of fresh) {
    const result = await importPolarExercise(admin, cfg, conn, e.id);
    if (result === 'unauthorized') {
      await markRevoked(admin, conn.id);
      out.revoked = true;
      return out;
    }
    if (result === 'imported') out.imported++;
    else if (result === 'duplicate') out.duplicates++;
    else if (result === 'refused') out.refused++;
    else out.failed++;
  }
  await recordDelivery(admin, conn.id, { ok: true });
  return out;
}

const DAILY_CONNECTIONS = 200;
const DAILY_PER_CONNECTION = 5;

/** The daily cron's phase: the net under a missed webhook. A no-op when
 *  Polar is not configured or 247 has not run. */
export async function runPolarSync(admin: Admin): Promise<{ connections: number; imported: number; failed: number; revoked: number }> {
  const summary = { connections: 0, imported: 0, failed: 0, revoked: 0 };
  const cfg = polarConfig();
  if (!cfg) return summary;
  const conns = await listActiveConnections(admin, 'polar', DAILY_CONNECTIONS);
  for (const conn of conns) {
    summary.connections++;
    const r = await syncPolarConnection(admin, cfg, conn, DAILY_PER_CONNECTION);
    summary.imported += r.imported;
    summary.failed += r.failed;
    if (r.revoked) summary.revoked++;
  }
  return summary;
}
