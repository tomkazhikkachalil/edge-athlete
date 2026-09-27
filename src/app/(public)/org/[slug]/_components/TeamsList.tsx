import Link from 'next/link';
import type { PublicTeam } from '@/lib/org-sites/public-data';
import TeamCrest from './TeamCrest';

// Teams module: linked name chips on the home page (detailed=false),
// rows with division/season labels on /teams (detailed=true). Every
// entry links to the team's own page inside the site.
export default function TeamsList({
  teams,
  basePath,
  detailed = false,
  variant = 'chips',
  click = 'detail',
}: {
  teams: PublicTeam[];
  basePath: string;
  detailed?: boolean;
  /** B2: the home render — chips (classic) or a tile grid (bold); program 3
   *  D1 adds 'list' (the /teams list, on the home) and `click` none; the
   *  sports-team program (L2) adds 'crests' — the team's crest + colour. */
  variant?: 'chips' | 'tiles' | 'list' | 'crests';
  click?: 'detail' | 'none';
}) {
  const href = (t: PublicTeam) => (click === 'none' ? undefined : `${basePath}/teams/${t.id}`);
  if (detailed || variant === 'list') {
    return (
      <ul className="mt-2 divide-y divide-border-subtle">
        {teams.map(t => (
          <li key={t.id} className="py-2.5">
            {href(t) ? (
              <Link href={href(t)!} className="text-sm font-medium text-brand-fg">
                {t.name}
              </Link>
            ) : (
              <span className="text-sm font-medium text-primary">{t.name}</span>
            )}
            {t.divisionLabels.length > 0 ? (
              <p className="text-xs text-tertiary">{t.divisionLabels.join(' · ')}</p>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }
  if (variant === 'crests') {
    return (
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-variant="crests">
        {teams.map(t => {
          const inner = (
            <>
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-1.5"
                style={{ backgroundColor: t.color && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : 'var(--org-accent)' }}
              />
              <TeamCrest name={t.name} logoUrl={t.logoUrl} color={t.color} ink={t.ink} size={56} />
              <span className="mt-2 block text-sm font-bold text-primary">{t.name}</span>
              {t.divisionLabels.length > 0 ? <span className="block text-xs text-tertiary">{t.divisionLabels[0]}</span> : null}
            </>
          );
          const cls = 'relative flex flex-col items-center overflow-hidden rounded-lg border border-border bg-surface px-3 pt-5 pb-3 text-center';
          return href(t) ? (
            <Link key={t.id} href={href(t)!} className={`${cls} hover:shadow-md transition-shadow`}>
              {inner}
            </Link>
          ) : (
            <span key={t.id} className={cls}>
              {inner}
            </span>
          );
        })}
      </div>
    );
  }
  if (variant === 'tiles') {
    return (
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2" data-variant="tiles">
        {teams.map(t => {
          const inner = (
            <>
              {t.name}
              {t.divisionLabels.length > 0 ? (
                <span className="mt-0.5 block text-xs font-normal text-tertiary">
                  {t.divisionLabels[0]}
                </span>
              ) : null}
            </>
          );
          const cls = 'block rounded-lg border border-border bg-canvas px-3 py-3 text-sm font-semibold text-primary';
          return href(t) ? (
            <Link key={t.id} href={href(t)!} className={cls}>
              {inner}
            </Link>
          ) : (
            <span key={t.id} className={cls}>
              {inner}
            </span>
          );
        })}
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {teams.map(t => {
        const cls = 'inline-block rounded-full border border-border bg-canvas px-3 py-1 text-sm font-medium text-primary';
        return href(t) ? (
          <Link key={t.id} href={href(t)!} className={cls}>
            {t.name}
          </Link>
        ) : (
          <span key={t.id} className={cls}>
            {t.name}
          </span>
        );
      })}
    </div>
  );
}
