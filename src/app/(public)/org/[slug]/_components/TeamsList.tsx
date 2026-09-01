import Link from 'next/link';
import type { PublicTeam } from '@/lib/org-sites/public-data';
import { orgSitePath } from '@/lib/org-sites/urls';

// Teams module: linked name chips on the home page (detailed=false),
// rows with division/season labels on /teams (detailed=true). Every
// entry links to the team's own page inside the site.
export default function TeamsList({
  teams,
  slug,
  detailed = false,
}: {
  teams: PublicTeam[];
  slug: string;
  detailed?: boolean;
}) {
  if (detailed) {
    return (
      <ul className="mt-2 divide-y divide-border-subtle">
        {teams.map(t => (
          <li key={t.id} className="py-2.5">
            <Link
              href={`${orgSitePath(slug)}/teams/${t.id}`}
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
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {teams.map(t => (
        <Link
          key={t.id}
          href={`${orgSitePath(slug)}/teams/${t.id}`}
          className="inline-block rounded-full border border-border bg-canvas px-3 py-1 text-sm font-medium text-primary"
        >
          {t.name}
        </Link>
      ))}
    </div>
  );
}
