import type { PublicCompetitionStandings } from '@/lib/competitions/public-standings';
import GolfWeeks from './GolfWeeks';
import PointsRaceTable from './PointsRaceTable';
import SeasonSummaryCard from './SeasonSummaryCard';
import { playerHref } from '@/lib/org-sites/player-links';

// One competition's standings card — the SSR markup shared by the
// league/club standings pages and the public org-site standings module.
// Server-safe and dependency-free ON PURPOSE: it renders inside the
// (public) segment, so no Font Awesome, no client hooks, no dark:
// variants (that segment never stamps data-theme). The overflow-x-auto
// wrapper is the 375px rule — wide tables scroll inside the card, the
// page never scrolls horizontally.
export default function PublicStandingsTable({
  competition,
  basePath,
}: {
  competition: PublicCompetitionStandings;
  /** P2: the org site's base path for player-page links; omit in the app
   *  (names then link to the athlete profile). */
  basePath?: string;
}) {
  return (
    <section
      aria-label={competition.name}
      className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
    >
      <h2 className="text-lg font-semibold text-primary">
        {competition.name}
        {competition.season_label ? (
          <span className="text-sm font-normal text-muted"> · {competition.season_label}</span>
        ) : null}
      </h2>
      {competition.seasonSummary && <SeasonSummaryCard summary={competition.seasonSummary} basePath={basePath} />}
      {/* W1: a fresh golf league has an open window before anyone has a
          standings row (standings count completed rounds only) — the
          table is skipped, the week below still renders. */}
      {competition.rows.length > 0 && (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                {competition.entrant_type === 'athlete' ? 'Player' : 'Team'}
              </th>
              {competition.columns.map(col => (
                // aria-label carries the full column name — title alone is
                // not a reliable accessible name for the abbreviation.
                <th
                  key={col.key}
                  scope="col"
                  aria-label={col.label}
                  className="py-1.5 px-2 font-medium text-right"
                  title={col.label}
                >
                  {col.shortLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {competition.rows.map(row => (
              <tr
                key={`${competition.id}-${row.rank}-${row.entrant_name}`}
                className="border-t border-border-subtle"
              >
                <td className="py-1.5 pr-2 text-muted">{row.rank}</td>
                <td className="py-1.5 pr-3 font-medium text-primary">
                  {row.playerHandle ? (
                    <a href={playerHref(row.playerHandle, basePath)} className="hover:underline">
                      {row.entrant_name}
                    </a>
                  ) : (
                    row.entrant_name
                  )}
                </td>
                {competition.columns.map(col => (
                  <td key={col.key} className="py-1.5 px-2 text-right text-secondary">
                    {/* G1: a null total is "no round yet", never 0 — on an
                        ascending board a 0 would read as the leader. */}
                    {col.key === 'played'
                      ? row.played
                      : col.key === 'points'
                        ? (row.points ?? '—')
                        : (row.stats[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      {competition.golf && <GolfWeeks golf={competition.golf} competitionId={competition.id} basePath={basePath} />}
      {competition.race && <PointsRaceTable race={competition.race} competitionId={competition.id} basePath={basePath} />}
      {/* Phase 6 R4: a disputed result must never read as settled —
          shared markup, so console twins and the public site all carry
          the same footnote (unconfirmed semantics, no new visual
          language). */}
      {competition.disputedCount > 0 && (
        <p className="mt-2 text-xs text-amber-700">
          Includes {competition.disputedCount === 1 ? 'a disputed result' : 'disputed results'}{' '}
          awaiting the organizer’s review.
        </p>
      )}
    </section>
  );
}
