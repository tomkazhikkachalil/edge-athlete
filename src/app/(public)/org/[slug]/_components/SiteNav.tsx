import Link from 'next/link';
import type { NavTeamGroup } from '@/lib/org-sites/nav-groups';

// ── The site's navigation (sports-team website program, L1, Sep 27 2026) ──
// Two renders of ONE link list, both server-safe and script-free:
//   • SiteNavInline — md and up: the link row (the "Site navigation" <nav>
//     specs read in order), with a Teams dropdown when the club has teams;
//   • SiteMenu — below md: a native <details> phone menu (it used to be the
//     same row wrapping into several lines of links on a phone).
// The dropdown and the menu are <details> (no client JS in (public)); links
// INSIDE them are plain <a> — the shell sits in a persistent layout, so a
// client-side navigation would leave the panel open on the next page.

export interface SiteNavTeams {
  groups: NavTeamGroup[];
  truncated: boolean;
  /** `${base}/teams` */
  allHref: string;
  /** `${base}/teams/` — a team's href is this + its id. */
  teamHrefPrefix: string;
}

export interface SiteNavLink {
  key: string;
  href: string;
  label: string;
  /** The teams module's entry: a dropdown when the club has teams to list. */
  teams?: SiteNavTeams;
}

export type SiteNavTone = 'bar' | 'band' | 'pro';

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="currentColor" className="inline-block ml-1 -mt-0.5">
      <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

function TeamGroups({ teams, linkClass }: { teams: SiteNavTeams; linkClass: string }) {
  return (
    <>
      {teams.groups.map(g => (
        <div key={g.label ?? '—'} className="py-1">
          {g.label && <p className="px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-tertiary">{g.label}</p>}
          <ul>
            {g.teams.map(t => (
              <li key={t.id}>
                <a href={`${teams.teamHrefPrefix}${t.id}`} className={linkClass}>
                  {t.name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <a href={teams.allHref} className={`${linkClass} font-semibold text-brand-fg`}>
        All teams{teams.truncated ? ' →' : ''}
      </a>
    </>
  );
}

export function SiteNavInline({ links, tone }: { links: SiteNavLink[]; tone: SiteNavTone }) {
  const linkClass =
    tone === 'band'
      ? 'text-sm font-medium text-white/90'
      : tone === 'pro'
        ? 'text-sm font-semibold uppercase tracking-wide text-primary hover:text-brand-fg'
        : 'text-sm font-medium text-secondary';
  return (
    <nav aria-label="Site navigation" className="site-container px-4 pb-3 hidden md:block">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {links.map(l =>
          l.teams && l.teams.groups.length > 0 ? (
            <details key={l.key} className="site-menu relative" data-site-teams-menu="">
              <summary className={linkClass}>
                {l.label}
                <Chevron />
              </summary>
              <div className="absolute left-0 top-full z-30 mt-2 w-64 max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface p-2 text-left shadow-lg">
                <TeamGroups teams={l.teams} linkClass="block rounded px-2 py-1.5 text-sm text-primary hover:bg-brand-soft" />
              </div>
            </details>
          ) : (
            <Link key={l.key} href={l.href} className={linkClass}>
              {l.label}
            </Link>
          )
        )}
      </div>
    </nav>
  );
}

export function SiteMenu({ links, tone }: { links: SiteNavLink[]; tone: SiteNavTone }) {
  const buttonClass =
    tone === 'band'
      ? 'text-white border-white/40'
      : 'text-primary border-border-strong';
  const item = 'block rounded-md px-3 py-2.5 text-base text-primary hover:bg-brand-soft';
  return (
    <details className="site-menu relative md:hidden" data-site-menu="">
      <summary
        className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${buttonClass}`}
        aria-label="Menu"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="currentColor">
          <path d="M3 5h14a1 1 0 1 0 0-2H3a1 1 0 0 0 0 2Zm14 4H3a1 1 0 0 0 0 2h14a1 1 0 1 0 0-2Zm0 6H3a1 1 0 1 0 0 2h14a1 1 0 1 0 0-2Z" />
        </svg>
        Menu
      </summary>
      <nav
        aria-label="Site menu"
        className="absolute right-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] max-h-[75vh] overflow-auto rounded-lg border border-border bg-surface p-2 text-left shadow-lg"
      >
        <ul>
          {links.map(l => (
            <li key={l.key}>
              {l.teams && l.teams.groups.length > 0 ? (
                <details className="site-menu">
                  <summary className={`${item} flex items-center justify-between`}>
                    {l.label}
                    <Chevron />
                  </summary>
                  <div className="pl-3">
                    <TeamGroups teams={l.teams} linkClass="block rounded-md px-3 py-2 text-sm text-primary hover:bg-brand-soft" />
                  </div>
                </details>
              ) : (
                <a href={l.href} className={item}>
                  {l.label}
                </a>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
