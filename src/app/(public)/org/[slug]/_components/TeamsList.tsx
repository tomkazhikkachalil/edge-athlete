import Link from 'next/link';
import type { PublicTeam } from '@/lib/org-sites/public-data';

// Teams module: linked name chips on the home page (detailed=false),
// rows with division/season labels on /teams (detailed=true). Every
// entry links to the team's own page inside the site.
export default function TeamsList({
  teams,
  basePath,
  detailed = false,
  variant = 'chips',
}: {
  teams: PublicTeam[];
  basePath: string;
  detailed?: boolean;
  /** B2: the home render — chips (classic) or a tile grid (bold). */
  variant?: 'chips' | 'tiles';
}) {
  if (detailed) {
    return (
      <ul className="mt-2 divide-y divide-border-subtle">
        {teams.map(t => (
          <li key={t.id} className="py-2.5">
            <Link
              href={`${basePath}/teams/${t.id}`}
              className="text-sm font-medium text-brand-fg"
            >
              {t.name}
            </Link>
            {t.divisionLabels.length > 0 ? (
              <p className="text-xs text-tertiary">{t.divisionLabels.join(' · ')}</p>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }
  if (variant === 'tiles') {
    return (
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {teams.map(t => (
          <Link
            key={t.id}
            href={`${basePath}/teams/${t.id}`}
            className="block rounded-lg border border-border bg-canvas px-3 py-3 text-sm font-semibold text-primary"
          >
            {t.name}
            {t.divisionLabels.length > 0 ? (
              <span className="mt-0.5 block text-xs font-normal text-tertiary">
                {t.divisionLabels[0]}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {teams.map(t => (
        <Link
          key={t.id}
          href={`${basePath}/teams/${t.id}`}
          className="inline-block rounded-full border border-border bg-canvas px-3 py-1 text-sm font-medium text-primary"
        >
          {t.name}
        </Link>
      ))}
    </div>
  );
}
