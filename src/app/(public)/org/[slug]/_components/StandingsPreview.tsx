import Link from 'next/link';
import type { PublicStandingsPayload } from '@/lib/competitions/public-standings';

// Home-page standings preview: the first competition with rows, top 5,
// three columns only (the full column engine lives on /standings via
// PublicStandingsTable). Props-only and server-safe like every module
// component here — the (public) segment has no Font Awesome, no dark:
// styling, no client hooks.
export default function StandingsPreview({
  standings,
  slug,
}: {
  standings: PublicStandingsPayload | null;
  slug: string;
}) {
  const first = standings?.competitions.find(c => c.rows.length > 0);
  if (!first) {
    return <p className="mt-1 text-sm text-tertiary">No published standings yet.</p>;
  }
  return (
    <div className="mt-3">
      <p className="text-sm font-medium text-secondary">
        {first.name}
        {first.season_label ? (
          <span className="font-normal text-muted"> · {first.season_label}</span>
        ) : null}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-1.5 pr-2 font-medium">#</th>
              <th scope="col" className="py-1.5 pr-3 font-medium">Team</th>
              <th scope="col" aria-label="Points" className="py-1.5 px-2 font-medium text-right">
                Pts
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
                <td className="py-1.5 px-2 text-right text-secondary">{row.points ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link
        href={`/org/${slug}/standings`}
        className="mt-3 inline-block text-sm text-brand-fg font-medium"
      >
        Full standings →
      </Link>
    </div>
  );
}
