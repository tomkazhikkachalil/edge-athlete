import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCachedPage, getCachedSite } from '@/lib/org-sites/cached';
import { isValidPageSlug, parsePageBody } from '@/lib/org-sites/validate';
import PageBlocks from '../_components/PageBlocks';

// ── /org/[slug]/[pageSlug] — a custom site page (phase 3 R3) ───────────────
// PUBLIC pages only (draft ⇔ missing, both notFound). The static module
// segments (standings/schedule/teams) beat this dynamic sibling, and the
// RESERVED_PAGE_SLUGS denylist keeps authors from ever creating a
// shadowed slug; isValidPageSlug also gates here BEFORE any query.

export const revalidate = 300;

// The App Router ISR rule (measured Sep 1): a dynamic segment is only
// ISR-eligible when generateStaticParams exists — an empty list
// prerenders nothing while making every runtime (slug, pageSlug) pair a
// cacheable ISR entry. Without it, permanent-MISS SSR.
export function generateStaticParams(): { slug: string; pageSlug: string }[] {
  return [];
}

interface PageParams {
  params: Promise<{ slug: string; pageSlug: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug, pageSlug } = await params;
  if (!isValidPageSlug(pageSlug)) return { title: 'Not found' };
  const site = await getCachedSite(slug);
  if (!site) return { title: 'Not found' };
  const page = await getCachedPage(slug, site.id, pageSlug);
  if (!page) return { title: 'Not found' };
  return {
    title: `${page.title} — ${site.orgName}`,
    description: `${page.title} — ${site.orgName} on Edge Athlete.`,
  };
}

export default async function OrgSitePage({ params }: PageParams) {
  const { slug, pageSlug } = await params;
  if (!isValidPageSlug(pageSlug)) notFound();
  const site = await getCachedSite(slug);
  if (!site) notFound();
  const page = await getCachedPage(slug, site.id, pageSlug);
  if (!page) notFound();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">{page.title}</h1>
      <section
        aria-label={page.title}
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        <PageBlocks blocks={parsePageBody(page.body)} siteId={site.id} />
      </section>
    </div>
  );
}
