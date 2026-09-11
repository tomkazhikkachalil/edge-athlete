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

// ── The console's read (E2) ─────────────────────────────────────────────────
import { NextResponse } from 'next/server';
import type { OrgSide } from '@/lib/orgs/authz';
import { rollupStats, statsWindow, type DailyRow, type StatsRange } from './analytics-rollup';

const ROWS_MAX = 5000;

/** The site's numbers for the last N days; `supported: false` pre-188. */
export async function statsGET(admin: Admin, side: OrgSide, orgId: string, days: StatsRange): Promise<NextResponse> {
  const { data: site } = await admin.from('org_sites').select('id, published_at').eq(side === 'league' ? 'league_id' : 'club_id', orgId).maybeSingle();
  const siteId = (site as { id: string } | null)?.id ?? null;
  if (!siteId) return NextResponse.json({ supported: true, live: false, stats: rollupStats([], days, new Date()) }, { headers: { 'Cache-Control': 'private, no-store' } });
  const { from, to } = statsWindow(days, new Date());
  const { data, error } = await admin.from('org_site_stats_daily').select('day, path, views, visitors').eq('site_id', siteId).gte('day', from).lte('day', to).limit(ROWS_MAX);
  if (error) {
    if (error.code === '42P01') return NextResponse.json({ supported: false }, { headers: { 'Cache-Control': 'private, no-store' } });
    console.error(`${TAG} stats read error:`, error);
    return NextResponse.json({ error: 'Failed to load the numbers' }, { status: 500 });
  }
  const rows = ((data ?? []) as { day: string; path: string; views: number; visitors: number }[]).map<DailyRow>(r => ({ day: String(r.day).slice(0, 10), path: r.path, views: Number(r.views) || 0, visitors: Number(r.visitors) || 0 }));
  return NextResponse.json({ supported: true, live: !!(site as { published_at: string | null }).published_at, counting: !!analyticsSecret(), stats: rollupStats(rows, days, new Date()) }, { headers: { 'Cache-Control': 'private, no-store' } });
}

/** Platform totals for the admin dashboard: the last 30 days across every site. */
export async function platformVisitsLast30(admin: Admin): Promise<{ views: number; visitors: number; sites: number } | null> {
  const { from, to } = statsWindow(30, new Date());
  const { data, error } = await admin.from('org_site_stats_daily').select('site_id, views, visitors').gte('day', from).lte('day', to).limit(50000);
  if (error || !data) return null;
  const sites = new Set<string>();
  let views = 0;
  let visitors = 0;
  for (const r of data as { site_id: string; views: number; visitors: number }[]) {
    sites.add(r.site_id);
    views += Number(r.views) || 0;
    visitors += Number(r.visitors) || 0;
  }
  return { views, visitors, sites: sites.size };
}
