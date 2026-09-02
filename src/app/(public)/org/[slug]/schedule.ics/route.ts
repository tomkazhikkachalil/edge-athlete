import { getCachedScheduleFeed, getCachedSite } from '@/lib/org-sites/cached';

// ── /org/[slug]/schedule.ics — the site's public calendar feed (phase 6e S4)
// Subscribe once, get the org's public events and its golf leagues' play
// windows forever. Viewer-independent by construction (no auth, no
// cookies — the same bytes for everyone), cached like every public
// reader (the org-site tag purges it), CDN-served. Published sites with
// the schedule module only — otherwise 404, like the schedule page.

export const revalidate = 300;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site || !site.modules.some(m => m.module_key === 'schedule' && m.enabled)) {
    return new Response('Not found', { status: 404 });
  }
  const ics = await getCachedScheduleFeed(slug, site.side, site.orgId, site.orgName);
  return new Response(ics, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="${slug}.ics"`,
      'cache-control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    },
  });
}
