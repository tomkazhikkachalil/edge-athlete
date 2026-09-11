import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { getDraftSiteBySlug } from '@/lib/org-sites/server';
import { verifyPreviewToken } from '@/lib/org-sites/preview-token';
import { loadDraftSnapshotBySiteId, loadRows, rowsSnapshot } from '@/lib/org-sites/revisions-server';
import { rawSiteReaders, resolveHomeData } from '@/lib/org-sites/widget-data';
import { isValidPageSlug } from '@/lib/org-sites/validate';
import { orderedPages, parsePageLayout } from '@/lib/site-builder/pages';
import GridRenderer from '@/app/(public)/org/[slug]/_components/GridRenderer';
import SiteShell from '@/app/(public)/org/[slug]/_components/SiteShell';

// ── /org/[slug]/preview/[token]/[pageSlug] — the draft preview of a PAGE ────
// Program 2, B4 (Sep 11 2026). The same token the home preview takes (it
// IS the authorization; verified before any read), the same shell, the same
// renderer — over the DRAFT's pages (the snapshot's; a site without a draft
// previews its published projection). A page the draft lacks is a 404, a
// draft page previews here too (the manager is the one looking).

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Draft preview', robots: { index: false, follow: false } };
}

export default async function OrgSitePagePreview({ params }: { params: Promise<{ slug: string; token: string; pageSlug: string }> }) {
  const { slug, token, pageSlug } = await params;
  const tokenSiteId = verifyPreviewToken(token);
  if (!tokenSiteId) notFound();
  if (!isValidPageSlug(pageSlug)) notFound();
  const admin = getSupabaseAdmin();
  const site = await getDraftSiteBySlug(admin, slug);
  if (!site || tokenSiteId !== site.id) notFound();

  const draft = await loadDraftSnapshotBySiteId(admin, site.id);
  const rows = draft ? null : await loadRows(admin, site.id);
  const snapshot = draft ?? (rows ? rowsSnapshot(rows) : null);
  const pages = orderedPages(snapshot?.pages);
  const page = pages.find(p => p.slug === pageSlug);
  const layout = page ? parsePageLayout(page.layout) : null;
  if (!page || !layout) notFound();

  const data = await resolveHomeData(rawSiteReaders(admin, site), site, layout);
  const links = pages.filter(p => p.visibility === 'public').map(p => ({ id: p.id, slug: p.slug, title: p.title, inNav: p.inNav, createdAt: p.createdAt }));

  return (
    <SiteShell site={site} pages={links}>
      <div className="bg-amber-100 border-b border-amber-300">
        <p className="max-w-4xl mx-auto px-4 py-2 text-sm font-medium text-amber-900">
          Draft preview of “{page.title}” — not public. This link expires; publish from the editor or the console to go live.
        </p>
      </div>
      <GridRenderer site={site} layout={layout} data={data} heading={page.title} />
    </SiteShell>
  );
}
