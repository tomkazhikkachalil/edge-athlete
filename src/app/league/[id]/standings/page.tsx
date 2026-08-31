import Link from 'next/link';
import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchPublicStandings } from '@/lib/competitions/public-standings';
import { UUID_RE } from '@/lib/golf/course-catalog';

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
  const payload = await fetchPublicStandings(getSupabaseAdmin(), 'league', id);
  if (!payload) return { title: 'Standings' };
  return {
    title: `${payload.orgName} Standings`,
    description: `Live standings for ${payload.orgName} on Edge Athlete.`,
  };
}

export default async function LeagueStandingsPage({ params }: PageParams) {
  const { id } = await params;
  const payload = UUID_RE.test(id)
    ? await fetchPublicStandings(getSupabaseAdmin(), 'league', id)
    : null;

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
          withRows.map(comp => (
            <section
              key={comp.id}
              aria-label={comp.name}
              className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
            >
              <h2 className="text-lg font-semibold text-primary">
                {comp.name}
                {comp.season_label ? (
                  <span className="text-sm font-normal text-muted"> · {comp.season_label}</span>
                ) : null}
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1.5 pr-2 font-medium">#</th>
                      <th className="py-1.5 pr-3 font-medium">Team</th>
                      {comp.columns.map(col => (
                        <th
                          key={col.key}
                          className="py-1.5 px-2 font-medium text-right"
                          title={col.label}
                        >
                          {col.shortLabel}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comp.rows.map(row => (
                      <tr
                        key={`${comp.id}-${row.rank}-${row.entrant_name}`}
                        className="border-t border-border-subtle"
                      >
                        <td className="py-1.5 pr-2 text-muted">{row.rank}</td>
                        <td className="py-1.5 pr-3 font-medium text-primary">{row.entrant_name}</td>
                        {comp.columns.map(col => (
                          <td key={col.key} className="py-1.5 px-2 text-right text-secondary">
                            {col.key === 'played'
                              ? row.played
                              : col.key === 'points'
                                ? (row.points ?? 0)
                                : (row.stats[col.key] ?? 0)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
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
