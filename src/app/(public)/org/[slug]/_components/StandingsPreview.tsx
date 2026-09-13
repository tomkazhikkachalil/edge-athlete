import Link from 'next/link';
import type { PublicCompetitionStandings, PublicStandingsPayload, PublicStandingRow } from '@/lib/competitions/public-standings';
import { formatDateRange } from '@/lib/competitions/golf-weeks';
import { playerHref } from '@/lib/org-sites/player-links';

// Home-page standings preview: the first competition with rows, top 5,
// three columns only (the full column engine lives on /standings via
// PublicStandingsTable). Program 3, D1: `variant` compact (today) or full
// (every column of the payload); `rows`; `sort` by rank (today) or name;
// `click` detail (a public player's handle links, as the full table does)
// or none.
function cell(c: { key: string }, row: PublicStandingRow): string {
  if (c.key === 'played') return String(row.played);
  if (c.key === 'points') return row.points === null ? '—' : String(row.points);
  const v = row.stats[c.key];
  return v === undefined ? '—' : String(v);
}

export default function StandingsPreview({
  standings,
  basePath,
  variant = 'compact',
  rows = 5,
  sort = 'rank',
  click = 'detail',
}: {
  standings: PublicStandingsPayload | null;
  basePath: string;
  variant?: 'compact' | 'full';
  rows?: number;
  sort?: 'rank' | 'name';
  click?: 'detail' | 'none';
}) {
  const first: PublicCompetitionStandings | undefined = standings?.competitions.find(c => c.rows.length > 0 || c.golf);
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
  const pointsColumn = first.columns.find(c => c.key === 'points') ?? {
    key: 'points',
    label: 'Points',
    shortLabel: 'Pts',
  };
  const columns = variant === 'full' ? first.columns : [pointsColumn];
  const shown = (sort === 'name' ? [...first.rows].sort((a, b) => a.entrant_name.localeCompare(b.entrant_name, undefined, { sensitivity: 'base' })) : first.rows).slice(0, rows);
  const name = (row: PublicStandingRow) =>
    click === 'detail' && row.playerHandle ? (
      <a href={playerHref(row.playerHandle, basePath)} className="hover:underline">
        {row.entrant_name}
      </a>
    ) : (
      row.entrant_name
    );
  return (
    <div className="mt-3" data-variant={variant}>
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
              {columns.map(c => (
                <th key={c.key} scope="col" aria-label={c.label} className="py-1.5 px-2 font-medium text-right">
                  {c.shortLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map(row => (
              <tr
                key={`${first.id}-${row.rank}-${row.entrant_name}`}
                className="border-t border-border-subtle"
              >
                <td className="py-1.5 pr-2 text-muted">{row.rank}</td>
                <td className="py-1.5 pr-3 font-medium text-primary">{name(row)}</td>
                {columns.map(c => (
                  <td key={c.key} className="py-1.5 px-2 text-right text-secondary tabular-nums">
                    {cell(c, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
      <span className="mt-3 flex flex-wrap gap-x-4">
        {currentWeek && (
          <Link href={`${basePath}/week`} className="inline-block text-sm text-brand-fg font-medium">
            This week →
          </Link>
        )}
        <Link href={`${basePath}/standings`} className="inline-block text-sm text-brand-fg font-medium">
          Full standings →
        </Link>
      </span>
    </div>
  );
}
