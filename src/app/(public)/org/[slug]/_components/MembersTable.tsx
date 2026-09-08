import Link from 'next/link';
import type { MemberStats } from '@/lib/golf/member-stats';

// ── The members table (Onboarding v2 R5) ────────────────────────────────────
// The Club Model's roster row: name, handicap index, rounds this season,
// scoring average, best round — every column derived from rounds members
// posted anyway (the two-key rule, applied upstream). Names arrive masked;
// only a public profile links (playerHandle). Props-only, same markup on
// the home section (compact) and the /members subpage (detailed).

function fmt(n: number | null): string {
  return n === null ? '—' : String(n);
}

export default function MembersTable({
  stats,
  basePath,
  detailed,
}: {
  stats: MemberStats;
  basePath: string;
  detailed: boolean;
}) {
  const rows = detailed ? stats.members : stats.members.slice(0, 8);
  if (rows.length === 0) return <p className="mt-1 text-sm text-tertiary">No members yet.</p>;
  return (
    <div>
      <p className="text-sm text-secondary mb-2">
        <span className="font-medium text-primary">{`${stats.memberCount} ${stats.memberCount === 1 ? 'member' : 'members'}`}</span>
        {stats.roundsPosted > 0 && <span className="text-muted">{` · ${stats.roundsPosted} ${stats.roundsPosted === 1 ? 'round' : 'rounds'} posted this year`}</span>}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-tertiary">
              <th className="py-1.5 pr-3 font-semibold">Member</th>
              <th className="py-1.5 pr-3 font-semibold text-right">HI</th>
              <th className="py-1.5 pr-3 font-semibold text-right" title="Rounds posted this season">Rounds</th>
              <th className="py-1.5 pr-3 font-semibold text-right" title="Scoring average, 18 holes">Avg 18</th>
              <th className="py-1.5 pr-3 font-semibold text-right" title="Best 18-hole gross this year">Best 18</th>
              {detailed && (
                <>
                  <th className="py-1.5 pr-3 font-semibold text-right" title="Scoring average, 9 holes">Avg 9</th>
                  <th className="py-1.5 font-semibold text-right" title="Best 9-hole gross this year">Best 9</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(m => (
              <tr key={m.profileId} className="border-t border-border-subtle">
                <td className="py-2 pr-3 text-primary font-medium">
                  {m.handle ? (
                    <Link href={`${basePath}/players/${encodeURIComponent(m.handle)}`} className="hover:text-brand-fg">
                      {m.name}
                    </Link>
                  ) : (
                    m.name
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-secondary">{m.handicap ?? '—'}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-secondary">{m.roundsThisSeason}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-secondary">{fmt(m.avg18)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-secondary">{m.best18 ? m.best18.gross : '—'}</td>
                {detailed && (
                  <>
                    <td className="py-2 pr-3 text-right tabular-nums text-secondary">{fmt(m.avg9)}</td>
                    <td className="py-2 text-right tabular-nums text-secondary">{m.best9 ? m.best9.gross : '—'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!detailed && stats.members.length > rows.length && (
        <Link href={`${basePath}/members`} className="mt-2 inline-block text-sm text-brand-fg font-medium">
          {`All ${stats.memberCount} members →`}
        </Link>
      )}
      {stats.recent.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-primary mb-1">Recent rounds</h3>
          <ul className="space-y-1 text-sm text-secondary">
            {stats.recent.slice(0, detailed ? 10 : 5).map((r, i) => (
              <li key={`${r.date}-${i}`} className="flex flex-wrap justify-between gap-x-3">
                <span>
                  {r.playerHandle ? (
                    <Link href={`${basePath}/players/${encodeURIComponent(r.playerHandle)}`} className="text-primary font-medium hover:text-brand-fg">{r.name}</Link>
                  ) : (
                    <span className="text-primary font-medium">{r.name}</span>
                  )}
                  {r.courseName ? <span className="text-muted">{` · ${r.courseName}`}</span> : null}
                </span>
                <span className="tabular-nums">{`${r.gross} · ${r.holes} holes · ${r.date}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
