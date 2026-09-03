import type { Metadata } from 'next';
import { getCachedNewsList, getCachedSite } from '@/lib/org-sites/cached';
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
  const posts = await getCachedNewsList(slug, site.id, site.visibility === 'private');

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
    </div>
  );
}
