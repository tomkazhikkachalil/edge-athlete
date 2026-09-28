import type { Metadata } from 'next';
import { isMembersOnly } from '@/lib/org-sites/private';
import MembersOnlyPage from '../../_components/MembersOnlyPage';
import { notFound } from 'next/navigation';
import { getCachedSite, getCachedTaggedNews, getCachedTeamPage } from '@/lib/org-sites/cached';
import NewsItems from '../../_components/NewsItems';
import { buildTeamJsonLd, safeJsonLd } from '@/lib/org-sites/jsonld';
import { UUID_RE } from '@/lib/golf/course-catalog';
import TeamScheduleList from '@/components/teams/TeamScheduleList';
import { teamLook } from '@/lib/teams/brand';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { isSportEnabled } from '@/lib/features';
import { requireSiteModule } from '../../_components/require-module';
import { siteAbsoluteUrl, siteBasePath } from '@/lib/org-sites/urls';

// ── /org/[slug]/teams/[teamId] — the FULL team page (phase 3 R2) ───────────
// Tom's decision 3: record row, upcoming schedule, and a MASKED roster
// (publicDisplayName — full name only for claimed public profiles). The
// reader filters by the org column, so a foreign teamId under this slug
// 404s indistinguishably. Media lives on /gallery (phase 4 R5) behind the
// photo-consent gate; team pages stay media-free by choice (deferred).
// Teams & divisions PR 7: the schedule is the team's WHOLE schedule —
// calendar events, its contests (a league's too) and the games it plays —
// with results from the team's side; the page wears the TEAM's colours when
// it has them (a re-scoped .org-scope: every brand token follows), its logo
// and sport in the header.

export const revalidate = 300;

// Both dynamic params ride the same ISR-eligibility rule: an empty list
// prerenders nothing while making every runtime (slug, teamId) pair a
// cacheable ISR entry.
export function generateStaticParams(): { slug: string; teamId: string }[] {
  return [];
}

interface PageParams {
  params: Promise<{ slug: string; teamId: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug, teamId } = await params;
  const site = await getCachedSite(slug);
  if (!site || !UUID_RE.test(teamId)) return { title: 'Not found' };
  const teamPage = await getCachedTeamPage(slug, site.side, site.orgId, teamId);
  if (!teamPage) return { title: 'Not found' };
  const title = `${teamPage.team.name} — ${site.orgName}`;
  const description = `${teamPage.team.name} of ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/teams/${teamId}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteTeamPage({ params }: PageParams) {
  const { slug, teamId } = await params;
  const site = await requireSiteModule(slug, 'teams');
  // Phase 9 V4: a private club renders the members-only panel here.
  if (isMembersOnly(site, 'teams')) return <MembersOnlyPage site={site} title={'Team'} what={'A team’s page'} />;
  if (!UUID_RE.test(teamId)) notFound();
  const teamPage = await getCachedTeamPage(slug, site.side, site.orgId, teamId, siteBasePath(site));
  if (!teamPage) notFound();

  const { team, records, schedule, roster } = teamPage;
  // N5 (243): the posts tagged to this team — only while the site has news.
  const newsOn = site.modules.some(m => m.module_key === 'news' && m.enabled);
  const teamNews = newsOn ? await getCachedTaggedNews(slug, site.id, site.visibility === 'private', { teamId: team.id }) : [];
  // The team's colours (validated hex, 242's CHECK) re-point the site's accent
  // for this page; without them the site's own accent stays.
  const look = teamLook({ id: team.id, primary_color: team.primaryColor, secondary_color: team.secondaryColor }, null);
  const teamStyle =
    look.source === 'team' && look.accent
      ? ({ '--org-accent': look.accent.fill, '--org-accent-strong': look.accent.fillStrong, '--org-accent-fg': look.accent.fgLight } as React.CSSProperties)
      : undefined;
  const sportLabel = team.sportKey && isSportEnabled(team.sportKey as SportKey) ? getSportDefinition(team.sportKey as SportKey).display_name : null;

  return (
    <div className={`site-container px-4 py-8 space-y-6${teamStyle ? ' org-scope' : ''}`} style={teamStyle} data-team-colours={teamStyle ? 'team' : 'site'}>
      {/* R4: SportsTeam structured data — the team and its org only,
          never the roster (no Person in JSON-LD, ever). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(buildTeamJsonLd(site, { id: team.id, name: team.name })),
        }}
      />
      <header className="flex items-center gap-4">
        {team.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- the tokenless team-logo streamer, busted by ?v (the org-logo precedent)
          <img src={team.logoUrl} alt={`${team.name} logo`} className="h-16 w-16 shrink-0 rounded-lg border border-border bg-surface object-contain" />
        ) : teamStyle ? (
          <span aria-hidden="true" className="h-16 w-16 shrink-0 rounded-lg" style={{ background: 'linear-gradient(135deg, var(--org-accent), var(--org-accent-strong))' }} />
        ) : null}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-primary break-words">{team.name}</h1>
          {sportLabel || team.divisionLabels.length > 0 ? (
            <p className="mt-1 text-sm text-tertiary">{[sportLabel, ...team.divisionLabels].filter(Boolean).join(' · ')}</p>
          ) : null}
        </div>
      </header>

      <section
        aria-label="Record"
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        <h2 className="text-lg font-semibold text-primary">Record</h2>
        {records.length === 0 ? (
          <p className="mt-1 text-sm text-tertiary">No published results yet.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Competition</th>
                  <th scope="col" className="py-1.5 px-2 font-medium text-right">Rank</th>
                  <th scope="col" className="py-1.5 px-2 font-medium text-right">Played</th>
                  <th scope="col" aria-label="Points" className="py-1.5 px-2 font-medium text-right">
                    Pts
                  </th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={`${r.competitionName}-${i}`} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-3 font-medium text-primary">
                      {r.competitionName}
                      {r.seasonLabel ? (
                        <span className="font-normal text-muted"> · {r.seasonLabel}</span>
                      ) : null}
                    </td>
                    <td className="py-1.5 px-2 text-right text-secondary">{r.rank}</td>
                    <td className="py-1.5 px-2 text-right text-secondary">{r.played}</td>
                    <td className="py-1.5 px-2 text-right text-secondary">{r.points ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section
        aria-label="Upcoming"
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        <h2 className="text-lg font-semibold text-primary">Upcoming</h2>
        <TeamScheduleList items={schedule.upcoming} empty="No upcoming events." />
      </section>

      <section
        aria-label="Results"
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        <h2 className="text-lg font-semibold text-primary">Results</h2>
        <TeamScheduleList items={schedule.results} empty="No results yet." />
      </section>

      {teamNews.length > 0 && (
        <section aria-label="Team news" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-team-news="">
          <h2 className="text-lg font-semibold text-primary">News</h2>
          <NewsItems posts={teamNews} siteId={site.id} basePath={siteBasePath(site)} />
        </section>
      )}

      <section
        aria-label="Roster"
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        <h2 className="text-lg font-semibold text-primary">Roster</h2>
        {roster.length === 0 ? (
          <p className="mt-1 text-sm text-tertiary">No public roster.</p>
        ) : (
          <ul className="mt-2 columns-2 sm:columns-3 gap-6">
            {roster.map((r, i) => (
              <li key={`${r.name}-${i}`} className="py-1 text-sm text-primary break-inside-avoid">
                {r.name}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
