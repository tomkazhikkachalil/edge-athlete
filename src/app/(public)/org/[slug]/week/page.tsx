import type { Metadata } from 'next';
import { isMembersOnly } from '@/lib/org-sites/private';
import MembersOnlyPage from '../_components/MembersOnlyPage';
import { getCachedSite, getCachedWeekHub } from '@/lib/org-sites/cached';
import { formatDateRange } from '@/lib/competitions/golf-weeks';
import { playerHref } from '@/lib/org-sites/player-links';
import { appBaseUrl, siteAbsoluteUrl, siteBasePath } from '@/lib/org-sites/urls';
import { requireSiteModule } from '../_components/require-module';

// ── /org/[slug]/week — "This week" (phase 8 P4) ─────────────────────────────
// The Tour site's live page, the members' edition: every active golf
// league's current window — how many days are left, who has posted and
// their points so far — and how many entrants are on the course right
// now. The count is the only live fact here (names for members live
// behind the app's /live door); the page branches on no viewer, so it is
// ISR + CDN like every other public page. Gated by the standings module.

export const revalidate = 300;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

interface PageParams {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) return { title: 'Not found' };
  const title = `This week — ${site.orgName}`;
  const description = `This week's play at ${site.orgName}: the open rounds, who has posted, and who is on the course.`;
  const canonical = `${siteAbsoluteUrl(site)}/week`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

function stateLine(week: NonNullable<Awaited<ReturnType<typeof getCachedWeekHub>>['leagues'][number]['week']>): string {
  if (week.state === 'open') {
    return week.daysLeft <= 0 ? 'Closes today' : week.daysLeft === 1 ? '1 day left' : `${week.daysLeft} days left`;
  }
  if (week.state === 'upcoming') {
    return week.daysLeft === 1 ? 'Opens tomorrow' : `Opens in ${week.daysLeft} days`;
  }
  return 'Closed';
}

function asOfLabel(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

export default async function OrgSiteWeekPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'standings');
  // Phase 9 V4: a private club renders the members-only panel here.
  if (isMembersOnly(site, 'standings')) return <MembersOnlyPage site={site} title={'This week'} what={'This week’s play'} />;
  const hub = await getCachedWeekHub(slug, site.side, site.orgId);
  const base = siteBasePath(site);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">This week</h1>
        <p className="mt-1 text-sm text-tertiary">{`Live play at ${site.orgName} · as of ${asOfLabel(hub.asOf)}`}</p>
      </header>

      {hub.leagues.length === 0 ? (
        <p className="text-sm text-tertiary">No league rounds are scheduled right now.</p>
      ) : (
        hub.leagues.map(league => (
          <section
            key={league.competitionId}
            aria-label={league.name}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary">
              {league.name}
              {league.seasonLabel ? <span className="text-sm font-normal text-muted"> · {league.seasonLabel}</span> : null}
            </h2>
            {!league.week ? (
              <p className="mt-1 text-sm text-tertiary">No round open this week.</p>
            ) : (
              (week => (
              <>
                <p className="mt-1 text-sm text-secondary">
                  <span className="font-medium text-primary">{week.round ?? 'Round'}</span>
                  {` · ${formatDateRange(week.playFrom, week.playTo)} · ${week.holes} holes`}
                  {week.courseName ? ` · ${week.courseName}` : ''}
                </p>
                <p className="mt-1 text-sm text-secondary">
                  <span className="font-medium text-primary">{stateLine(league.week)}</span>
                  {` · ${week.posted} of ${week.participants} posted`}
                </p>
                {week.state === 'open' && (
                  <p className="mt-1 text-sm text-secondary" data-on-course={league.onCourseNow}>
                    <span className="font-medium text-primary">
                      {league.onCourseNow === 0
                        ? 'Nobody on the course right now'
                        : league.onCourseNow === 1
                          ? '1 member on the course now'
                          : `${league.onCourseNow} members on the course now`}
                    </span>
                    {' · '}
                    <a href={`${appBaseUrl()}/live`} className="text-brand-fg font-medium hover:underline">
                      See who’s playing (members) →
                    </a>
                  </p>
                )}
                {week.results.length > 0 && (
                  <div className="relative mt-3 overflow-x-auto">
                    <table className="w-full text-sm whitespace-nowrap">
                      <thead>
                        <tr className="text-left text-xs text-muted">
                          <th scope="col" className="py-1.5 pr-3 font-medium">Player</th>
                          <th scope="col" className="py-1.5 px-2 font-medium text-right">Gross</th>
                          <th scope="col" className="py-1.5 px-2 font-medium text-right">Net</th>
                          {week.results.some(r => typeof r.points === 'number') && (
                            <th scope="col" className="py-1.5 px-2 font-medium text-right">PTS</th>
                          )}
                          <th scope="col" className="py-1.5 pl-2 font-medium">
                            <span className="sr-only">Status</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {week.results.map((r, i) => (
                          <tr key={`${league.competitionId}-${i}`} className="border-t border-border-subtle">
                            <td className="py-1.5 pr-3 font-medium text-primary">
                              {r.playerHandle ? (
                                <a href={playerHref(r.playerHandle, base)} className="hover:underline">
                                  {r.entrant_name}
                                </a>
                              ) : (
                                r.entrant_name
                              )}
                            </td>
                            <td className="py-1.5 px-2 text-right text-secondary">{r.gross ?? '—'}</td>
                            <td className="py-1.5 px-2 text-right text-secondary">{r.net ?? '—'}</td>
                            {week.results.some(x => typeof x.points === 'number') && (
                              <td className="py-1.5 px-2 text-right font-medium text-primary">{r.points ?? '—'}</td>
                            )}
                            <td className="py-1.5 pl-2 text-xs text-muted">{r.status === 'posted' ? 'posted' : 'final'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
              ))(league.week)
            )}
            <p className="mt-2 text-xs">
              <a href={`${base}/standings`} className="text-brand-fg font-medium hover:underline">
                Standings →
              </a>
            </p>
          </section>
        ))
      )}
    </div>
  );
}
