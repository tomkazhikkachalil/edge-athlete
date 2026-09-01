import { cache } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchPublicStandings } from '@/lib/competitions/public-standings';
import PublicStandingsTable from '@/components/standings/PublicStandingsTable';
import { UUID_RE } from '@/lib/golf/course-catalog';

// generateMetadata AND the page body need the same payload; React cache()
// dedupes them to ONE fetch per request (stage-gate fix — this page is
// dynamic on every hit by the spike verdict, so the double fetch doubled
// real DB load under crawler traffic).
const getStandings = cache((id: string) =>
  fetchPublicStandings(getSupabaseAdmin(), 'league', id)
);

// ── /league/[id]/standings — THE SPIKE (phase 2 R3) ─────────────────────────
// The repo's FIRST server-component data page and first generateMetadata:
// anonymous, crawlable HTML — team names and points are IN THE SOURCE,
// no client fetch. Reads are service-role gated on
// competitions.visibility='public' (the viewer-independent contract:
// nothing here branches on a session). The page is dynamic like every
// page (the root layout's CSP nonce); the PUBLIC_STANDINGS_CACHE
// middleware carve-out is the measured experiment that decides phase 3's
// rendering mechanism — see the DEVLOG verdict.
//
// Chrome is deliberately minimal (no AppHeader): this is the shareable
// public artifact, not an app surface; the org page link is the way in.

interface PageParams {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: 'Standings' };
  const payload = await getStandings(id);
  if (!payload) return { title: 'Standings' };
  return {
    title: `${payload.orgName} Standings`,
    description: `Live standings for ${payload.orgName} on Edge Athlete.`,
  };
}

export default async function LeagueStandingsPage({ params }: PageParams) {
  const { id } = await params;
  const payload = UUID_RE.test(id) ? await getStandings(id) : null;

  if (!payload) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-primary mb-2">League not found</h1>
          <Link href="/explore" className="text-sm text-brand-fg font-medium">
            Explore Edge Athlete →
          </Link>
        </div>
      </div>
    );
  }

  const withRows = payload.competitions.filter(c => c.rows.length > 0);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-surface border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted">Standings</p>
            <h1 className="text-xl sm:text-2xl font-bold text-primary truncate">
              {payload.orgName}
            </h1>
          </div>
          <Link
            href={`/league/${id}`}
            className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium shrink-0"
          >
            League page →
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {withRows.length === 0 ? (
          <p className="text-sm text-tertiary">No published standings yet.</p>
        ) : (
          withRows.map(comp => <PublicStandingsTable key={comp.id} competition={comp} />)
        )}
        <p className="text-xs text-muted">
          Powered by{' '}
          <Link href="/" className="text-brand-fg">
            Edge Athlete
          </Link>
        </p>
      </main>
    </div>
  );
}
