import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { rollupSiteMetrics, type MetricsRevisionRow, type MetricsSiteRow } from '@/lib/site-builder/metrics-rollup';
import { isMissingTableError } from '@/lib/org-sites/validate';

// 42703 = a pointer column missing (pre-180); PGRST204 = PostgREST's schema-cache twin.
const isMissingColumnError = (code: string | undefined) => code === '42703' || code === 'PGRST204';

// ── /api/admin/site-metrics (Site Builder phase 11) ─────────────────────────
// The builder's numbers, COMPUTED from the sites and their published
// revisions' `stats` (mig 180) — nothing stored, nothing vendored. Admin-
// only (the flagged-slugs pattern). Pre-180 (no pointer columns / no table)
// answers `{ supported: false }` rather than a 500. Both reads are capped;
// `truncated` says when the numbers are a floor.

const SITES_LIMIT = 2000;
const REVISIONS_LIMIT = 5000;

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = getSupabaseAdmin();
    const [sitesRes, revisionsRes] = await Promise.all([
      admin.from('org_sites').select('id, created_at, published_at, template_id, draft_revision_id, published_revision_id').limit(SITES_LIMIT),
      admin
        .from('org_site_revisions')
        .select('id, site_id, published_at, stats')
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(REVISIONS_LIMIT),
    ]);
    for (const res of [sitesRes, revisionsRes]) {
      if (res.error) {
        if (isMissingTableError(res.error.code) || isMissingColumnError(res.error.code)) {
          return NextResponse.json({ supported: false }, { headers: { 'Cache-Control': 'no-store' } });
        }
        console.error('[SITE-METRICS] read error:', res.error);
        return NextResponse.json({ error: 'Failed to load site metrics' }, { status: 500 });
      }
    }
    const sites = (sitesRes.data ?? []) as unknown as MetricsSiteRow[];
    const revisions = (revisionsRes.data ?? []) as unknown as MetricsRevisionRow[];
    const truncated = sites.length >= SITES_LIMIT || revisions.length >= REVISIONS_LIMIT;
    const metrics = rollupSiteMetrics(sites, revisions, new Date().toISOString(), truncated);
    return NextResponse.json({ supported: true, metrics }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SITE-METRICS] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
