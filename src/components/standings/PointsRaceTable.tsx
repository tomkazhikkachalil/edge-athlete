import type { PointsRace } from '@/lib/competitions/golf-race';

// The points race (phase 8 P1) — one league's season, week by week: each
// round's points, the running total and the movement into the latest
// week. Server-safe and dependency-free ON PURPOSE (it renders inside the
// (public) segment): no client hooks, no Font Awesome, no dark: variants.
// The overflow-x-auto wrapper is the 375px rule — the table scrolls inside
// the card, the page never scrolls horizontally.

function weekLabel(round: string | null, index: number): string {
  if (!round) return `W${index + 1}`;
  // "Week 3" → "W3"; anything else is shown as-is (short).
  const m = /^week\s+(\d+)$/i.exec(round.trim());
  return m ? `W${m[1]}` : round;
}

function Movement({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted">—</span>;
  if (value === 0) return <span className="text-muted">·</span>;
  const up = value > 0;
  return (
    <span className={up ? 'text-emerald-700' : 'text-red-700'} aria-label={`${up ? 'up' : 'down'} ${Math.abs(value)}`}>
      {up ? '▲' : '▼'}
      {Math.abs(value)}
    </span>
  );
}

export default function PointsRaceTable({ race, competitionId }: { race: PointsRace; competitionId: string }) {
  if (race.rows.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-sm font-semibold text-primary">Points race</h3>
      <p className="text-xs text-muted">Points by week, the running total, and places gained or lost into the latest week.</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Player</th>
              {race.weeks.map((w, i) => (
                <th key={w.contestId} scope="col" className="py-1.5 px-2 font-medium text-right" title={w.round ?? undefined}>
                  {weekLabel(w.round, i)}
                </th>
              ))}
              <th scope="col" className="py-1.5 px-2 font-medium text-right">Total</th>
              <th scope="col" className="py-1.5 pl-2 font-medium text-right">Move</th>
            </tr>
          </thead>
          <tbody>
            {race.rows.map(row => {
              const rank = row.rank[row.rank.length - 1];
              return (
                <tr key={`${competitionId}-${row.entryId}`} className="border-t border-border-subtle">
                  <td className="py-1.5 pr-2 text-muted">{rank ?? '—'}</td>
                  <td className="py-1.5 pr-3 font-medium text-primary">{row.entrant_name}</td>
                  {row.weekly.map((pts, i) => (
                    <td key={race.weeks[i]?.contestId ?? i} className="py-1.5 px-2 text-right text-secondary">
                      {pts ?? '—'}
                    </td>
                  ))}
                  <td className="py-1.5 px-2 text-right font-semibold text-primary">{row.total}</td>
                  <td className="py-1.5 pl-2 text-right">
                    <Movement value={row.movement} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
