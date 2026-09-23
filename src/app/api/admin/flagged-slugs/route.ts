import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { judgeSlug } from '@/lib/org-sites/slug-policy';
import { isMissingTableError } from '@/lib/org-sites/validate';
import { reportRouteError } from '@/lib/observability/report';
import { orgKindOf } from '@/lib/orgs/org-ref';

// ── /api/admin/flagged-slugs (phase 6 R1) ───────────────────────────────────
// The anti-squatting review list, COMPUTED — no storage. Every org-site
// slug is re-judged against its org's live identity, so the list is
// always current: renames, org-name changes and policy tightening all
// reflect immediately. Verdict 'ok' rows are dropped; 'flagged' and
// 'refused' (grandfathered pre-policy slugs) are returned for review.

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = getSupabaseAdmin();
    const { data: sites, error } = await admin
      .from('org_sites')
      .select('id, subdomain, org_id, org:organizations(kind), published_at')
      .limit(500);
    if (error) {
      if (isMissingTableError(error.code)) return NextResponse.json({ flagged: [] });
      reportRouteError('[FLAGGED-SLUGS] sites read error:', error);
      return NextResponse.json({ error: 'Failed to load sites' }, { status: 500 });
    }

    const leagueIds = (sites ?? []).filter(s => orgKindOf(s) === 'league').map(s => s.org_id as string);
    const clubIds = (sites ?? []).filter(s => orgKindOf(s) === 'club').map(s => s.org_id as string);
    const [leaguesRes, clubsRes] = await Promise.all([
      leagueIds.length
        ? admin.from('leagues').select('id, name, sport_key, city, region').in('id', leagueIds)
        : Promise.resolve({ data: [] }),
      clubIds.length
        ? admin.from('clubs').select('id, name, sport_key, city, region').in('id', clubIds)
        : Promise.resolve({ data: [] }),
    ]);
    const orgById = new Map(
      [...(leaguesRes.data ?? []), ...(clubsRes.data ?? [])].map(o => [o.id as string, o])
    );

    const flagged = (sites ?? []).flatMap(site => {
      const org = orgById.get(site.org_id as string);
      if (!org) return [];
      const judged = judgeSlug(site.subdomain as string, {
        name: org.name as string,
        sportKey: (org.sport_key as string | null) ?? null,
        city: (org.city as string | null) ?? null,
        region: (org.region as string | null) ?? null,
      });
      if (judged.verdict === 'ok') return [];
      return [
        {
          siteId: site.id,
          slug: site.subdomain,
          orgName: org.name,
          side: orgKindOf(site) ?? 'club',
          published: !!site.published_at,
          verdict: judged.verdict,
          reason: judged.reason,
        },
      ];
    });
    return NextResponse.json({ flagged });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[FLAGGED-SLUGS] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
