import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCachedSite } from '@/lib/org-sites/cached';

// ── /org/[slug] — the site shell (phase 3 R1) ───────────────────────────────
// Published sites only (draft = 404, the publish gate). The fetch is
// unstable_cache'd per slug with the `org-site:{slug}` tag — the console's
// publish/edit writes revalidateTag it — plus the 300s baseline, so these
// documents are ISR: rendered once, CDN-served, refreshed on demand.
// Viewer-independent by construction (the standings contract).

export const revalidate = 300;

export default async function OrgSiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) notFound();

  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <header className="bg-surface border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <Link href={`/org/${site.subdomain}`} className="min-w-0">
            <span className="text-xl font-bold text-primary truncate">{site.orgName}</span>
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 text-xs text-faint">
          Powered by{' '}
          <Link href="/" className="text-brand-fg">
            Edge Athlete
          </Link>
        </div>
      </footer>
    </div>
  );
}
