import type { Metadata } from 'next';
import { getCachedSite } from '@/lib/org-sites/cached';
import { parseDocuments } from '@/lib/org-sites/validate';
import DocumentsList from '../_components/DocumentsList';
import { requireSiteModule } from '../_components/require-module';
import { siteBasePath, siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/documents — documents & policies (phase 6b B3) ────────────
// The list lives in the module's config (stored PDFs + https links);
// no extra reader. Module disabled → notFound.

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
  const title = `${site.orgName} Documents`;
  const description = `Documents and policies from ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/documents`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteDocumentsPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'documents');
  const documents = parseDocuments(site.modules.find(m => m.module_key === 'documents')?.config);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">Documents</h1>
      {documents.length === 0 ? (
        <p className="text-sm text-tertiary">No documents yet.</p>
      ) : (
        <DocumentsList documents={documents} siteId={site.id} basePath={siteBasePath(site)} detailed />
      )}
    </div>
  );
}
