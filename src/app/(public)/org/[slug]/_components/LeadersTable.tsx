import Link from 'next/link';
import type { PublicLeaderBoard } from '@/lib/org-sites/public-data';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { playerHref } from '@/lib/org-sites/player-links';

// Stat leaders module (phase 6b B3): per public competition, the schema's
// sum tiles (Goals, Points…) as top-five tables. Names arrive already
// masked/omitted by the reader (supervised athletes never reach here).
// A sport with no stat-line schema says so instead of showing nothing —
// except a golf LEADERBOARD (S5), whose boards come from its results.

function sportName(key: string): string {
  return SPORT_REGISTRY[key as keyof typeof SPORT_REGISTRY]?.display_name ?? key;
}

function Podium({ stat, basePath, click }: { stat: PublicLeaderBoard['stats'][number]; basePath: string; click: 'detail' | 'none' }) {
  // The top three as tiles (2 · 1 · 3), then the rest as a plain list.
  const top = stat.rows.slice(0, 3);
  const rest = stat.rows.slice(3);
  const order = [top[1], top[0], top[2]].filter((r): r is PublicLeaderBoard['stats'][number]['rows'][number] => !!r);
  const name = (row: PublicLeaderBoard['stats'][number]['rows'][number]) =>
    click === 'detail' && row.playerHandle ? (
      <a href={playerHref(row.playerHandle, basePath)} className="font-medium text-primary hover:underline">
        {row.name}
      </a>
    ) : (
      <span className="font-medium text-primary">{row.name}</span>
    );
  return (
    <div data-variant="podium">
      <p className="mt-2 text-xs font-medium text-muted">
        {stat.label} · {stat.valueLabel ?? 'Total'}
      </p>
      <ol className="mt-2 grid grid-cols-3 items-end gap-2">
        {order.map(row => {
          const rank = stat.rows.indexOf(row) + 1;
          return (
            <li key={`${row.name}-${rank}`} className={`rounded-lg border border-border bg-canvas px-2 py-2 text-center ${rank === 1 ? 'pt-4' : ''}`}>
              <span className="block text-xs text-muted">#{rank}</span>
              <span className="block truncate text-sm">{name(row)}</span>
              <span className="block text-lg font-semibold text-primary tabular-nums">{row.value}</span>
            </li>
          );
        })}
      </ol>
      {rest.length > 0 && (
        <ol start={4} className="mt-2 divide-y divide-border-subtle text-sm">
          {rest.map((row, i) => (
            <li key={`${row.name}-${i}`} className="flex items-baseline justify-between gap-3 py-1">
              <span>
                <span className="mr-2 text-tertiary">{i + 4}</span>
                {name(row)}
              </span>
              <span className="font-semibold text-primary tabular-nums">{row.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Board({ board, limit, basePath, rows = 10, variant = 'table', click = 'detail' }: { board: PublicLeaderBoard; limit: number; basePath: string; rows?: number; variant?: 'table' | 'podium'; click?: 'detail' | 'none' }) {
  if (board.unsupported) {
    return (
      <p className="mt-1 text-sm text-tertiary">
        Stat leaders aren’t available for {sportName(board.sportKey).toLowerCase()} yet.
      </p>
    );
  }
  const stats = board.stats.slice(0, limit).map(stat => ({ ...stat, rows: stat.rows.slice(0, rows) }));
  if (stats.length === 0) return <p className="mt-1 text-sm text-tertiary">No stats recorded yet.</p>;
  if (variant === 'podium') {
    return (
      <div className="mt-2 grid gap-4 sm:grid-cols-2">
        {stats.map(stat => (
          <Podium key={stat.label} stat={stat} basePath={basePath} click={click} />
        ))}
      </div>
    );
  }
  return (
    <div className="mt-2 grid gap-4 sm:grid-cols-2">
      {stats.map(stat => (
        <div key={stat.label} className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">{stat.label}</th>
                <th scope="col" className="py-1.5 px-2 font-medium text-right">{stat.valueLabel ?? 'Total'}</th>
              </tr>
            </thead>
            <tbody>
              {stat.rows.map((row, i) => (
                <tr key={`${row.name}-${i}`} className="border-t border-border-subtle">
                  <td className="py-1.5 pr-2 text-tertiary">{i + 1}</td>
                  <td className="py-1.5 pr-3">
                    {row.playerHandle && click === 'detail' ? (
                      <a href={playerHref(row.playerHandle, basePath)} className="font-medium text-primary hover:underline">
                        {row.name}
                      </a>
                    ) : (
                      <span className="font-medium text-primary">{row.name}</span>
                    )}
                    {row.note ?? row.teamName ? (
                      <span className="block text-xs text-tertiary">{row.note ?? row.teamName}</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 px-2 text-right font-semibold text-primary">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default function LeadersTable({
  boards,
  basePath,
  detailed,
  boardsShown = 1,
  rows = 10,
  variant = 'table',
  click = 'detail',
}: {
  boards: PublicLeaderBoard[];
  basePath: string;
  /** Home shows the first competition's first stat; /leaders shows all. */
  detailed: boolean;
  /** Program 3, D1: stats shown on the home (of the first competition), rows per stat, table or podium, and whether names link. */
  boardsShown?: number;
  rows?: number;
  variant?: 'table' | 'podium';
  click?: 'detail' | 'none';
}) {
  if (!detailed) {
    const first = boards[0];
    return (
      <>
        {first ? (
          <>
            <p className="mt-2 text-sm font-medium text-secondary">{first.competitionName}</p>
            <Board board={first} limit={boardsShown} basePath={basePath} rows={rows} variant={variant} click={click} />
          </>
        ) : null}
        <Link href={`${basePath}/leaders`} className="mt-3 inline-block text-sm text-brand-fg font-medium">
          All leaders →
        </Link>
      </>
    );
  }
  return (
    <div className="space-y-6">
      {boards.map(board => (
        <section
          key={board.competitionId}
          aria-label={board.competitionName}
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary">{board.competitionName}</h2>
          <p className="text-xs text-tertiary">{sportName(board.sportKey)}</p>
          <Board board={board} limit={8} basePath={basePath} />
        </section>
      ))}
    </div>
  );
}
