import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCachedSite } from '@/lib/org-sites/cached';
import { MODULE_SUBPAGE_KEYS, MODULE_TITLES } from '@/lib/org-sites/validate';

// ── /org/[slug] — the site shell (phase 3 R1, nav in R2) ────────────────────
// Published sites only (draft = 404, the publish gate). The fetch is
// unstable_cache'd per slug with the `org-site:{slug}` tag — the console's
// publish/edit writes revalidateTag it — plus the 300s baseline, so these
// documents are ISR: rendered once, CDN-served, refreshed on demand.
// Viewer-independent by construction (the standings contract). The nav
// strip lists only ENABLED subpage modules — a console toggle purges the
// same cache entry, so nav, home, and subpages flip together.

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

  const navKeys = MODULE_SUBPAGE_KEYS.filter(key =>
    site.modules.some(m => m.module_key === key && m.enabled)
  );

  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <header className="bg-surface border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <Link href={`/org/${site.subdomain}`} className="min-w-0">
            {/* block, not inline — truncate's ellipsis only works on a
                block box, and an inline span's nowrap overflows 375px. */}
            <span className="block text-xl font-bold text-primary truncate">{site.orgName}</span>
          </Link>
        </div>
        {navKeys.length > 0 && (
          <nav aria-label="Site navigation" className="max-w-4xl mx-auto px-4 pb-3">
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <Link
                href={`/org/${site.subdomain}`}
                className="text-sm font-medium text-secondary"
              >
                Home
              </Link>
              {navKeys.map(key => (
                <Link
                  key={key}
                  href={`/org/${site.subdomain}/${key}`}
                  className="text-sm font-medium text-secondary"
                >
                  {MODULE_TITLES[key]}
                </Link>
              ))}
            </div>
          </nav>
        )}
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
