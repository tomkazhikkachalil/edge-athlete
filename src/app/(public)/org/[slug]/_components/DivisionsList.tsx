import Link from 'next/link';
import type { PublicDivision } from '@/lib/org-sites/public-data';

// Divisions module (phase 6b B3): teams grouped by division for the
// current seasons. Team names link to the team page inside the site;
// division labels carry the age band / tier when the org set them.
export default function DivisionsList({
  divisions,
  basePath,
  detailed,
}: {
  divisions: PublicDivision[];
  basePath: string;
  /** Home lists names + counts; /divisions shows every team. */
  detailed: boolean;
}) {
  if (!detailed) {
    return (
      <>
        <ul className="mt-2 divide-y divide-border-subtle">
          {divisions.slice(0, 8).map(d => (
            <li key={`${d.seasonLabel}-${d.divisionName}`} className="py-2 flex justify-between gap-3">
              <span className="text-sm font-medium text-primary">
                {d.divisionName}
                {d.seasonLabel ? <span className="font-normal text-muted"> · {d.seasonLabel}</span> : null}
              </span>
              <span className="text-xs text-tertiary shrink-0">
                {d.teams.length} {d.teams.length === 1 ? 'team' : 'teams'}
              </span>
            </li>
          ))}
        </ul>
        <Link href={`${basePath}/divisions`} className="mt-3 inline-block text-sm text-brand-fg font-medium">
          All divisions →
        </Link>
      </>
    );
  }
  return (
    <div className="space-y-6">
      {divisions.map(d => (
        <section
          key={`${d.seasonLabel}-${d.divisionName}`}
          aria-label={d.divisionName}
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary">{d.divisionName}</h2>
          <p className="text-xs text-tertiary">
            {[d.seasonLabel, d.ageBand, d.tier].filter(Boolean).join(' · ')}
          </p>
          {d.teams.length === 0 ? (
            <p className="mt-2 text-sm text-tertiary">No teams entered yet.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {d.teams.map(t => (
                <Link
                  key={t.id}
                  href={`${basePath}/teams/${t.id}`}
                  className="inline-block rounded-full border border-border bg-canvas px-3 py-1 text-sm font-medium text-primary"
                >
                  {t.name}
                </Link>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
