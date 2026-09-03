import type { Metadata } from 'next';
import { getCachedClubDirectory } from '@/lib/org-sites/cached';
import { appBaseUrl, orgSitePath } from '@/lib/org-sites/urls';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// ── /clubs — the public club directory (phase 9 V6) ─────────────────────────
// A crawlable list of every published club site, grouped by region:
// name, place, sport, and "Private club · request to join" for a private
// one. Identity only — no people — so it is viewer-independent and ISR
// like the rest of the (public) segment. `clubs` is a reserved root slug
// (the middleware's vanity path skips it; no org can take the subdomain).

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const title = 'Golf clubs on Edge Athlete';
  const description = 'Find a golf club near you — standings, leagues, the week’s play and how to join.';
  const canonical = `${appBaseUrl()}/clubs`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website' },
  };
}

function sportName(key: string | null): string | null {
  if (!key) return null;
  return SPORT_REGISTRY[key as keyof typeof SPORT_REGISTRY]?.display_name ?? key;
}

export default async function ClubDirectoryPage() {
  const regions = await getCachedClubDirectory();
  const app = appBaseUrl();
  const total = regions.reduce((n, r) => n + r.clubs.length, 0);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-surface border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted">Edge Athlete</p>
            <h1 className="text-xl sm:text-2xl font-bold text-primary">Golf clubs</h1>
          </div>
          <a href={`${app}/club/start?sport=golf`} className="text-sm text-brand-fg font-medium shrink-0">
            Start a club →
          </a>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8" data-directory-count={total}>
        {total === 0 ? (
          <p className="text-sm text-tertiary">No clubs have published a site yet.</p>
        ) : (
          regions.map(region => (
            <section key={region.label} aria-label={region.label}>
              <h2 className="text-lg font-semibold text-primary">{region.label}</h2>
              <ul className="mt-2 divide-y divide-border-subtle rounded-lg border border-border bg-surface">
                {region.clubs.map(club => {
                  const href = club.customDomain ? `https://${club.customDomain}` : orgSitePath(club.subdomain);
                  const meta = [club.city, sportName(club.sport)].filter(Boolean).join(' · ');
                  return (
                    <li key={club.subdomain} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <a href={href} className="text-sm font-medium text-primary hover:text-brand-fg">
                          {club.name}
                        </a>
                        {meta ? <span className="block text-xs text-muted">{meta}</span> : null}
                      </span>
                      {club.visibility === 'private' ? (
                        <span className="text-xs text-secondary" data-directory-private="1">
                          Private club · request to join
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Open to visitors</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
        <p className="text-xs text-muted">
          Run a club?{' '}
          <a href={`${app}/club/start?sport=golf`} className="text-brand-fg font-medium">
            Start yours on Edge Athlete →
          </a>
        </p>
      </main>
    </div>
  );
}
