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

  // L5 (Sep 27 2026): a CSS-only lightbox — each photo links to `#photo-N`;
  // its overlay shows while it is the :target (globals.css .site-lightbox),
  // with previous / next / close as plain links. No script (the public tree
  // ships none); the large images are lazy inside hidden overlays, so nothing
  // extra loads until one is opened. Videos keep their inline player.
  const photos = items.filter(i => i.mediaType === 'image');
  const photoIndex = new Map(photos.map((p, i) => [p.id, i] as const));
  const caption = (item: (typeof items)[number]) => [item.competitionName, galleryDate(item.date)].filter(Boolean).join(' · ');

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">Gallery</h1>
      <section
        id="gallery-grid"
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
                  <a href={`#photo-${photoIndex.get(item.id)! + 1}`} className="block" aria-label={`Open ${item.caption ?? `${item.competitionName} photo`}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- gate-checked streamer bytes; not an optimizable public asset */}
                    <img
                      src={item.url}
                      alt={item.caption ?? `${item.competitionName} photo`}
                      loading="lazy"
                      className="aspect-square w-full object-cover rounded-lg border border-border hover:opacity-90 transition-opacity"
                    />
                  </a>
                ) : (
                  <video
                    src={item.url}
                    controls
                    preload="metadata"
                    className="aspect-square w-full object-cover rounded-lg border border-border"
                  />
                )}
                <p className="mt-1 text-xs text-muted truncate">{caption(item)}</p>
                {item.tagLabels.length > 0 && (
                  <p className="text-xs text-tertiary truncate">{item.tagLabels.join(', ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {photos.map((item, i) => {
        const n = i + 1;
        const prev = i > 0 ? `#photo-${n - 1}` : null;
        const next = i < photos.length - 1 ? `#photo-${n + 1}` : null;
        const nav = 'inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-white/15 px-4 text-sm font-semibold text-white hover:bg-white/25';
        return (
          <div key={item.id} id={`photo-${n}`} className="site-lightbox" role="dialog" aria-label={`Photo ${n} of ${photos.length}`} data-site-lightbox={n}>
            <a href="#gallery-grid" className="absolute inset-0" aria-label="Close" tabIndex={-1} />
            <figure className="relative z-10 flex max-h-full w-full max-w-5xl flex-col items-center gap-3">
              {/* The stored size reserves the box before the bytes land (a lazy image with no size is 0×0 until then); none stored → a floor. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- gate-checked streamer bytes; not an optimizable public asset */}
              <img
                src={item.url}
                alt={item.caption ?? `${item.competitionName} photo`}
                loading="lazy"
                {...(item.width && item.height ? { width: item.width, height: item.height } : {})}
                className="max-h-[75vh] w-auto max-w-full min-h-24 rounded-lg object-contain"
              />
              <figcaption className="text-center text-sm text-white/90">
                {item.caption ? <span className="block font-medium text-white">{item.caption}</span> : null}
                {caption(item)}
                {item.tagLabels.length > 0 ? <span className="block text-white/75">{item.tagLabels.join(', ')}</span> : null}
              </figcaption>
              <div className="flex items-center gap-3">
                {prev ? <a href={prev} className={nav}>← Previous</a> : null}
                <a href="#gallery-grid" className={nav} data-site-lightbox-close="">Close</a>
                {next ? <a href={next} className={nav}>Next →</a> : null}
              </div>
            </figure>
          </div>
        );
      })}
    </div>
  );
}
