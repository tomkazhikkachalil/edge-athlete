import type { Metadata } from 'next';
import { getCachedLeagueDirectory } from '@/lib/org-sites/cached';
import { appBaseUrl, orgSitePath } from '@/lib/org-sites/urls';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// ── /leagues — the public league directory (program 11 L3) ─────────────────
// The league twin of /clubs (phase 9 V6): a crawlable list of every
// published league site, grouped by region: name, place, sport, and
// "Private league · request to join" for a private one. Identity only —
// no people — so it is viewer-independent and ISR like the rest of the
// (public) segment. `leagues` is a reserved root slug (the middleware's
// vanity path skips it; no org can take the subdomain).

export const revalidate = 3600;

export async function generateMetadata(): Promise<Metadata> {
  const title = 'Leagues on Edge Athlete';
  const description = 'Find a league near you — standings, the week’s play, results and how to join.';
  const canonical = `${appBaseUrl()}/leagues`;
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

export default async function LeagueDirectoryPage() {
  const regions = await getCachedLeagueDirectory();
  const app = appBaseUrl();
  const total = regions.reduce((n, r) => n + r.orgs.length, 0);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-surface border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted">Edge Athlete</p>
            <h1 className="text-xl sm:text-2xl font-bold text-primary">Leagues</h1>
          </div>
          <a href={`${app}/league/start`} className="text-sm text-brand-fg font-medium shrink-0">
            Start a league →
          </a>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8" data-directory-count={total}>
        {total === 0 ? (
          <p className="text-sm text-tertiary">No leagues have published a site yet.</p>
        ) : (
          regions.map(region => (
            <section key={region.label} aria-label={region.label}>
              <h2 className="text-lg font-semibold text-primary">{region.label}</h2>
              <ul className="mt-2 divide-y divide-border-subtle rounded-lg border border-border bg-surface">
                {region.orgs.map(league => {
                  const href = league.customDomain ? `https://${league.customDomain}` : orgSitePath(league.subdomain);
                  const meta = [league.city, sportName(league.sport)].filter(Boolean).join(' · ');
                  return (
                    <li key={league.subdomain} className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0">
                        <a href={href} className="text-sm font-medium text-primary hover:text-brand-fg">
                          {league.name}
                        </a>
                        {meta ? <span className="block text-xs text-muted">{meta}</span> : null}
                      </span>
                      {league.visibility === 'private' ? (
                        <span className="text-xs text-secondary" data-directory-private="1">
                          Private league · request to join
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
          Run a league?{' '}
          <a href={`${app}/league/start`} className="text-brand-fg font-medium">
            Start yours on Edge Athlete →
          </a>
        </p>
      </main>
    </div>
  );
}
