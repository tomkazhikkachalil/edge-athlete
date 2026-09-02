import Link from 'next/link';
import type { PublicLeaderBoard } from '@/lib/org-sites/public-data';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// Stat leaders module (phase 6b B3): per public competition, the schema's
// sum tiles (Goals, Points…) as top-five tables. Names arrive already
// masked/omitted by the reader (supervised athletes never reach here).
// A sport with no stat-line schema says so instead of showing nothing.

function sportName(key: string): string {
  return SPORT_REGISTRY[key as keyof typeof SPORT_REGISTRY]?.display_name ?? key;
}

function Board({ board, limit }: { board: PublicLeaderBoard; limit: number }) {
  if (board.unsupported) {
    return (
      <p className="mt-1 text-sm text-tertiary">
        Stat leaders aren’t available for {sportName(board.sportKey).toLowerCase()} yet.
      </p>
    );
  }
  const stats = board.stats.slice(0, limit);
  if (stats.length === 0) return <p className="mt-1 text-sm text-tertiary">No stats recorded yet.</p>;
  return (
    <div className="mt-2 grid gap-4 sm:grid-cols-2">
      {stats.map(stat => (
        <div key={stat.label} className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
                <th scope="col" className="py-1.5 pr-3 font-medium">{stat.label}</th>
                <th scope="col" className="py-1.5 px-2 font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {stat.rows.map((row, i) => (
                <tr key={`${row.name}-${i}`} className="border-t border-border-subtle">
                  <td className="py-1.5 pr-2 text-tertiary">{i + 1}</td>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium text-primary">{row.name}</span>
                    {row.teamName ? <span className="block text-xs text-tertiary">{row.teamName}</span> : null}
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
}: {
  boards: PublicLeaderBoard[];
  basePath: string;
  /** Home shows the first competition's first stat; /leaders shows all. */
  detailed: boolean;
}) {
  if (!detailed) {
    const first = boards[0];
    return (
      <>
        {first ? (
          <>
            <p className="mt-2 text-sm font-medium text-secondary">{first.competitionName}</p>
            <Board board={first} limit={1} />
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
          <Board board={board} limit={8} />
        </section>
      ))}
    </div>
  );
}
