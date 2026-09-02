import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCachedNewsPost, getCachedSite } from '@/lib/org-sites/cached';
import { formatEventWhen } from '@/lib/org-sites/format';
import { isValidPageSlug, parsePageBody } from '@/lib/org-sites/validate';
import PageBlocks from '../../_components/PageBlocks';
import { requireSiteModule } from '../../_components/require-module';
import { siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/news/[newsSlug] — one news post (phase 3.5) ────────────────
// PUBLISHED posts only (draft ⇔ missing, both notFound). The body is the
// shared block array rendered by PageBlocks; the slug rides the shared
// regex + denylist and gates before any query.

export const revalidate = 300;

// Both dynamic params ride the ISR-eligibility rule: an empty list
// prerenders nothing while making every runtime (slug, newsSlug) pair a
// cacheable ISR entry.
export function generateStaticParams(): { slug: string; newsSlug: string }[] {
  return [];
}

interface PageParams {
  params: Promise<{ slug: string; newsSlug: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug, newsSlug } = await params;
  if (!isValidPageSlug(newsSlug)) return { title: 'Not found' };
  const site = await getCachedSite(slug);
  if (!site) return { title: 'Not found' };
  const post = await getCachedNewsPost(slug, site.id, newsSlug);
  if (!post) return { title: 'Not found' };
  const title = `${post.title} — ${site.orgName}`;
  const description = `${post.title} — news from ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/news/${post.slug}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'article', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteNewsPostPage({ params }: PageParams) {
  const { slug, newsSlug } = await params;
  if (!isValidPageSlug(newsSlug)) notFound();
  const site = await requireSiteModule(slug, 'news');
  const post = await getCachedNewsPost(slug, site.id, newsSlug);
  if (!post) notFound();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">{post.title}</h1>
        <p className="mt-1 text-xs text-muted">
          {formatEventWhen({ starts_at: post.publishedAt, all_day: true, timezone: null })}
        </p>
      </header>
      <section
        aria-label={post.title}
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        <PageBlocks blocks={parsePageBody(post.body)} siteId={site.id} />
      </section>
    </div>
  );
}
