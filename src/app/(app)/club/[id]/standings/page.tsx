import { cache } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchPublicStandings } from '@/lib/competitions/public-standings';
import PublicStandingsTable from '@/components/standings/PublicStandingsTable';
import { UUID_RE } from '@/lib/golf/course-catalog';

// generateMetadata AND the page body need the same payload; React cache()
// dedupes them to ONE fetch per request (the league twin's stage-gate fix).
const getStandings = cache((id: string) =>
  fetchPublicStandings(getSupabaseAdmin(), 'club', id)
);

// ── /club/[id]/standings — the club twin of the league spike page ───────────
// Phase 3 R2 closes the club standings gap: fetchPublicStandings and the
// /api/clubs/[id]/standings route supported clubs since phase 2, but the
// crawlable SSR page only existed for leagues. Same contract as the league
// page: anonymous, viewer-independent, minimal chrome; the middleware's
// PUBLIC_STANDINGS_CACHE carve-out covers both paths.

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

export default async function ClubStandingsPage({ params }: PageParams) {
  const { id } = await params;
  const payload = UUID_RE.test(id) ? await getStandings(id) : null;

  if (!payload) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold text-primary mb-2">Club not found</h1>
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
            href={`/club/${id}`}
            className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium shrink-0"
          >
            Club page →
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {withRows.length === 0 ? (
          <p className="text-sm text-tertiary">No published standings yet.</p>
        ) : (
          withRows.map(comp => <PublicStandingsTable key={comp.id} competition={comp} />)
        )}
        <p className="text-xs text-faint">
          Powered by{' '}
          <Link href="/" className="text-brand-fg">
            Edge Athlete
          </Link>
        </p>
      </main>
    </div>
  );
}
