import type { Metadata } from 'next';
import { getCachedNewsList, getCachedNotices, getCachedSite } from '@/lib/org-sites/cached';
import { formatEventWhen } from '@/lib/org-sites/format';
import NewsItems from '../_components/NewsItems';
import { requireSiteModule } from '../_components/require-module';
import { siteBasePath, siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/news — the news feed (phase 3.5) ───────────────────────────
// Published posts only, newest first, title + date + first-paragraph
// excerpt + (N1) a cover thumbnail derived from the first image block.
// Module disabled → notFound (disabled modules don't exist).

export const revalidate = 300;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

interface PageParams {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return { title: 'Not found' };
  const title = `${site.orgName} News`;
  const description = `News and announcements from ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/news`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteNewsPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'news');
  const [posts, notices] = await Promise.all([
    getCachedNewsList(slug, site.id, site.visibility === 'private'),
    getCachedNotices(slug, site.side, site.orgId, site.orgName),
  ]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">News</h1>
      <section
        aria-label="News posts"
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        {posts.length === 0 ? (
          <p className="text-sm text-tertiary">No news yet.</p>
        ) : (
          <NewsItems posts={posts} siteId={site.id} basePath={siteBasePath(site)} />
        )}
      </section>
      {/* N3: announcements the manager also put on the notice band — the
          public half of the archive (members read everything in the app). */}
      {notices.length > 0 && (
        <section
          aria-label="Notices"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          data-notices={notices.length}
        >
          <h2 className="text-lg font-semibold text-primary">Notices</h2>
          <ul className="mt-2 divide-y divide-border-subtle">
            {notices.map(n => (
              <li key={n.id} className="py-3" data-notice={n.id}>
                <p className="text-base font-semibold text-primary">{n.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {formatEventWhen({ starts_at: n.createdAt, all_day: true, timezone: null })}
                </p>
                <p className="mt-1 text-sm text-secondary whitespace-pre-wrap">{n.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
