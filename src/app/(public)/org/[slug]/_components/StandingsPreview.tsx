import Link from 'next/link';
import type { PublicStandingsPayload } from '@/lib/competitions/public-standings';
import { formatDateRange } from '@/lib/competitions/golf-weeks';

// Home-page standings preview: the first competition with rows, top 5,
// three columns only (the full column engine lives on /standings via
// PublicStandingsTable). Props-only and server-safe like every module
// component here — the (public) segment has no Font Awesome, no dark:
// styling, no client hooks.
export default function StandingsPreview({
  standings,
  basePath,
}: {
  standings: PublicStandingsPayload | null;
  basePath: string;
}) {
  // W1: a golf league with an open window but no completed round yet has
  // no rows — it still has a week to show.
  const first = standings?.competitions.find(c => c.rows.length > 0 || c.golf);
  if (!first) {
    return <p className="mt-1 text-sm text-tertiary">No published standings yet.</p>;
  }
  const currentWeek = first.golf?.weeks.find(w => w.id === first.golf?.currentWeekId) ?? null;
  const weekLead = currentWeek
    ? currentWeek.state === 'open'
      ? 'This week'
      : currentWeek.state === 'upcoming'
        ? 'Next round'
        : 'Last round'
    : null;
  // G1: the sort key's own label (Pts / Net / Gross / Total), never a fixed "Pts".
  const pointsColumn = first.columns.find(c => c.key === 'points') ?? {
    key: 'points',
    label: 'Points',
    shortLabel: 'Pts',
  };
  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-secondary">
        {first.name}
        {first.season_label ? (
          <span className="font-normal text-muted"> · {first.season_label}</span>
        ) : null}
      </p>
      {currentWeek && (
        <p className="mt-1 text-sm text-secondary">
          <span className="font-medium text-primary">{weekLead}:</span>{' '}
          {currentWeek.round ?? 'Round'} · {formatDateRange(currentWeek.playFrom, currentWeek.playTo)} ·{' '}
          {currentWeek.posted} of {currentWeek.participants} posted
        </p>
      )}
      {first.rows.length > 0 && (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">
                {first.entrant_type === 'athlete' ? 'Player' : 'Team'}
              </th>
              <th scope="col" aria-label={pointsColumn.label} className="py-1.5 px-2 font-medium text-right">
                {pointsColumn.shortLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {first.rows.slice(0, 5).map(row => (
              <tr
                key={`${first.id}-${row.rank}-${row.entrant_name}`}
                className="border-t border-border-subtle"
              >
                <td className="py-1.5 pr-2 text-muted">{row.rank}</td>
                <td className="py-1.5 pr-3 font-medium text-primary">{row.entrant_name}</td>
                <td className="py-1.5 px-2 text-right text-secondary">{row.points ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <Link
        href={`${basePath}/standings`}
        className="mt-3 inline-block text-sm text-brand-fg font-medium"
      >
        Full standings →
      </Link>
    </div>
  );
}
