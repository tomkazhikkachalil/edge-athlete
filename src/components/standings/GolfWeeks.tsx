import { formatDateRange, formatIsoDate, type PublicGolfBlock, type PublicGolfWeek } from '@/lib/competitions/golf-weeks';

// A golf leaderboard's week-to-week view (phase 6d W1): the round the
// page leads with (open → "This week"; next to open → "Next round"; the
// last closed one otherwise), who has posted and what they shot, then the
// closed rounds as native <details> (collapsed, no client JS) and the
// upcoming ones as a line each. Props-only and dependency-free ON PURPOSE
// like PublicStandingsTable: it renders under the (public) segment (no
// Font Awesome, no hooks, no dark: variants) AND inside the client
// OrgStandings card. Names arrive masked; supervised athletes are already
// omitted by the reader. overflow-x-auto is the 375px rule.

function leadLabel(week: PublicGolfWeek): string {
  if (week.state === 'open') return 'This week';
  if (week.state === 'upcoming') return 'Next round';
  return 'Last round';
}

function meta(week: PublicGolfWeek): string {
  const bits = [week.courseName, formatDateRange(week.playFrom, week.playTo), `${week.holes} holes`].filter(Boolean);
  return bits.join(' · ');
}

function Chip({ status }: { status: 'posted' | 'final' }) {
  return status === 'posted' ? (
    <span className="inline-block rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
      posted
    </span>
  ) : (
    <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      final
    </span>
  );
}

function ResultsTable({ week, competitionId }: { week: PublicGolfWeek; competitionId: string }) {
  if (week.results.length === 0) {
    return (
      <p className="mt-2 text-sm text-tertiary">
        {week.state === 'upcoming' ? `Opens ${formatIsoDate(week.playFrom)}.` : 'No rounds posted yet.'}
      </p>
    );
  }
  const showNet = week.results.some(r => r.net !== null);
  const showGross = week.results.some(r => r.gross !== null);
  // C6: a points league's week shows the points each round earned.
  const showPoints = week.results.some(r => typeof r.points === 'number');
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1.5 pr-3 font-medium">Player</th>
            {showGross && (
              <th scope="col" className="py-1.5 px-2 font-medium text-right">Gross</th>
            )}
            {showNet && (
              <th scope="col" className="py-1.5 px-2 font-medium text-right">Net</th>
            )}
            {showPoints && (
              <th scope="col" className="py-1.5 px-2 font-medium text-right">PTS</th>
            )}
            <th scope="col" className="py-1.5 pl-2 font-medium text-right">
              <span className="sr-only">Status</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {week.results.map(r => (
            <tr key={`${competitionId}-${week.id}-${r.entrant_name}`} className="border-t border-border-subtle">
              <td className="py-1.5 pr-3 font-medium text-primary">
                {r.entrant_name}
                {r.tee ? <span className="ml-1 text-xs font-normal text-muted">{r.tee}</span> : null}
              </td>
              {showGross && (
                <td className="py-1.5 px-2 text-right text-secondary">{r.gross ?? '—'}</td>
              )}
              {showNet && (
                <td className="py-1.5 px-2 text-right text-secondary">{r.net ?? '—'}</td>
              )}
              {showPoints && (
                <td className="py-1.5 px-2 text-right font-medium text-primary">{r.points ?? '—'}</td>
              )}
              <td className="py-1.5 pl-2 text-right">
                <Chip status={r.status} />
                {r.disputed ? <span className="ml-1 text-[11px] text-amber-700">disputed</span> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GolfWeeks({
  golf,
  competitionId,
}: {
  golf: PublicGolfBlock;
  competitionId: string;
}) {
  const current = golf.weeks.find(w => w.id === golf.currentWeekId) ?? null;
  const closed = golf.weeks.filter(w => w.state === 'closed' && w.id !== golf.currentWeekId);
  const upcoming = golf.weeks.filter(w => w.state === 'upcoming' && w.id !== golf.currentWeekId);

  return (
    <div className="mt-4 border-t border-border-subtle pt-4" aria-label="Rounds">
      {current && (
        <section aria-label={leadLabel(current)}>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{leadLabel(current)}</p>
          <p className="mt-0.5 text-sm font-medium text-primary">
            {current.round ?? 'Round'}
            <span className="font-normal text-muted"> · {meta(current)}</span>
          </p>
          <p className="mt-0.5 text-xs text-secondary">
            {current.posted} of {current.participants} posted
            {golf.pick === 'best' ? ' · best round of the week counts' : ''}
          </p>
          <ResultsTable week={current} competitionId={competitionId} />
        </section>
      )}
      {closed.length > 0 && (
        <div className="mt-3 space-y-1">
          {[...closed].reverse().map(week => (
            <details key={week.id} className="rounded-lg border border-border-subtle px-3 py-2">
              <summary className="cursor-pointer text-sm text-primary">
                <span className="font-medium">{week.round ?? 'Round'}</span>
                <span className="text-muted"> · {meta(week)}</span>
                <span className="ml-2 text-xs text-secondary">{week.posted} posted</span>
              </summary>
              <ResultsTable week={week} competitionId={competitionId} />
            </details>
          ))}
        </div>
      )}
      {upcoming.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-sm text-secondary">
          {upcoming.map(week => (
            <li key={week.id}>
              <span className="font-medium text-primary">{week.round ?? 'Round'}</span>
              <span className="text-muted"> · opens {formatIsoDate(week.playFrom)} · {meta(week)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
