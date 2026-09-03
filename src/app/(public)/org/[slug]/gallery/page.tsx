import type { Metadata } from 'next';
import { moduleLabel, parseNavConfig } from '@/lib/org-sites/validate';
import { isMembersOnly } from '@/lib/org-sites/private';
import MembersOnlyPage from '../_components/MembersOnlyPage';
import { getCachedGallery, getCachedSite } from '@/lib/org-sites/cached';
import { requireSiteModule } from '../_components/require-module';
import { siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/gallery — consent-gated contest media (phase 4 R5) ──────────
// Every item passed the gallery gate at read time (org-published AND all
// tagged athletes photo-consented), and the streamer behind each URL
// re-runs the same gate per request — a stale ISR document can never
// out-serve a consent revoke. Tagged names are masked; supervised
// athletes carry no label at all. Module disabled → notFound.

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
  const title = `${site.orgName} Gallery`;
  const description = `Photos and videos from ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/gallery`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

const galleryDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
};

export default async function OrgSiteGalleryPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'gallery');
  // Phase 9 V4: a private club renders the members-only panel here.
  if (isMembersOnly(site, 'gallery')) return <MembersOnlyPage site={site} title={moduleLabel('gallery', parseNavConfig(site.nav_config), site.side, site.sportKey)} what={'The gallery'} />;
  const items = await getCachedGallery(slug, site.side, site.orgId);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">Gallery</h1>
      <section
        aria-label="Gallery"
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        {items.length === 0 ? (
          <p className="text-sm text-tertiary">No photos yet.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {items.map(item => (
              <li key={item.id}>
                {item.mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- gate-checked streamer bytes; not an optimizable public asset
                  <img
                    src={item.url}
                    alt={item.caption ?? `${item.competitionName} photo`}
                    loading="lazy"
                    className="aspect-square w-full object-cover rounded-lg border border-border"
                  />
                ) : (
                  <video
                    src={item.url}
                    controls
                    preload="metadata"
                    className="aspect-square w-full object-cover rounded-lg border border-border"
                  />
                )}
                <p className="mt-1 text-xs text-muted truncate">
                  {[item.competitionName, galleryDate(item.date)].filter(Boolean).join(' · ')}
                </p>
                {item.tagLabels.length > 0 && (
                  <p className="text-xs text-tertiary truncate">{item.tagLabels.join(', ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
