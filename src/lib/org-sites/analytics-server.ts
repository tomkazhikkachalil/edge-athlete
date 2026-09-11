import type { SupabaseClient } from '@supabase/supabase-js';
import { analyticsPruneCutoffs, analyticsSecret, dayKeyUTC, visitorHash } from './analytics';

// ── The server half of site analytics — program 2, E (Sep 11 2026) ─────────
// One RPC per page view (mig 188, service-role only); a daily prune. Every
// failure is swallowed and logged once — the pixel must never be slow or
// loud, and a missing migration simply counts nothing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;
const TAG = '[SITE ANALYTICS]';
let reported = false;

/** Count one view (and, when the mark is new for the day, one visitor). */
export async function recordSiteHit(admin: Admin, input: { siteId: string; path: string; ip: string; ua: string; now?: Date }): Promise<boolean> {
  const secret = analyticsSecret();
  if (!secret) return false;
  const now = input.now ?? new Date();
  const day = dayKeyUTC(now);
  const hash = visitorHash(secret, day, input.ip, input.ua);
  const timeout = new Promise<{ error: { code?: string; message?: string } }>(resolve => setTimeout(() => resolve({ error: { code: 'TIMEOUT', message: 'bump_site_hit took too long' } }), 1500));
  const result = await Promise.race([admin.rpc('bump_site_hit', { p_site: input.siteId, p_day: day, p_path: input.path, p_hash: hash }), timeout]);
  if (result.error) {
    if (!reported) {
      reported = true;
      console.error(`${TAG} hit not recorded (once):`, result.error);
    }
    return false;
  }
  return true;
}

/** Marks older than 2 days go (the day's uniqueness is the only reason
 *  they exist); daily rows older than 400 days go. */
export async function runAnalyticsPrune(admin: Admin, now = new Date()): Promise<{ ok: boolean; marks: number; daily: number }> {
  const cut = analyticsPruneCutoffs(now);
  const marks = await admin.from('org_site_hit_marks').delete().lt('day', cut.marksBefore).select('day');
  const daily = await admin.from('org_site_stats_daily').delete().lt('day', cut.dailyBefore).select('day');
  if (marks.error?.code === '42P01' || daily.error?.code === '42P01') return { ok: true, marks: 0, daily: 0 }; // pre-188
  if (marks.error || daily.error) {
    console.error(`${TAG} prune error:`, marks.error ?? daily.error);
    return { ok: false, marks: 0, daily: 0 };
  }
  return { ok: true, marks: marks.data?.length ?? 0, daily: daily.data?.length ?? 0 };
}
