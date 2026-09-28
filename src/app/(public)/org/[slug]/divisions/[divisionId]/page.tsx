import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isMembersOnly } from '@/lib/org-sites/private';
import MembersOnlyPage from '../../_components/MembersOnlyPage';
import { getCachedDivisionPage, getCachedSite, getCachedTaggedNews } from '@/lib/org-sites/cached';
import NewsItems from '../../_components/NewsItems';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { requireSiteModule } from '../../_components/require-module';
import { siteAbsoluteUrl, siteBasePath } from '@/lib/org-sites/urls';
import PublicStandingsTable from '@/components/standings/PublicStandingsTable';
import TeamScheduleList from '@/components/teams/TeamScheduleList';
import { NextGameCard } from '@/components/teams/GameDayCards';
import { nextGameOf } from '@/lib/teams/schedule';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { isSportEnabled } from '@/lib/features';

// ── /org/[slug]/divisions/[divisionId] — one division (teams & divisions PR 9) ─
// The division's teams (each a door to its team page), the standings of the
// competitions pinned to it, and its schedule — played games home-first
// ("Comets 2–3 Blazers"). The reader pins the division to THIS org, so a
// foreign id under this slug 404s indistinguishably; the Divisions module
// gates the page (disabled or switched off → 404); a private org renders the
// members-only panel. ISR + CDN like every page here.

export const revalidate = 300;

export function generateStaticParams(): { slug: string; divisionId: string }[] {
  return [];
}

interface PageParams {
  params: Promise<{ slug: string; divisionId: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug, divisionId } = await params;
  const site = await getCachedSite(slug);
  if (!site || !UUID_RE.test(divisionId)) return { title: 'Not found' };
  const view = await getCachedDivisionPage(slug, site.side, site.orgId, divisionId, siteBasePath(site));
  if (!view) return { title: 'Not found' };
  const title = `${view.division.name} — ${site.orgName}`;
  const description = `Teams, standings and schedule for ${view.division.name} at ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/divisions/${divisionId}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteDivisionPage({ params }: PageParams) {
  const { slug, divisionId } = await params;
  const site = await requireSiteModule(slug, 'divisions');
  if (isMembersOnly(site, 'divisions')) return <MembersOnlyPage site={site} title="Division" what="A division’s page" />;
  if (!UUID_RE.test(divisionId)) notFound();
  const base = siteBasePath(site);
  const view = await getCachedDivisionPage(slug, site.side, site.orgId, divisionId, base);
  if (!view) notFound();
  const { division, teams, standings, schedule } = view;
  const sport = isSportEnabled(division.sportKey as SportKey) ? getSportDefinition(division.sportKey as SportKey).display_name : null;
  const card = 'bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6';
  const withRows = standings.filter(c => c.rows.length > 0 || c.golf);
  // N5 (243): the posts tagged to this division — only while the site has news.
  const newsOn = site.modules.some(m => m.module_key === 'news' && m.enabled);
  const divisionNews = newsOn ? await getCachedTaggedNews(slug, site.id, site.visibility === 'private', { divisionId: division.id }) : [];

  return (
    <div className="site-container px-4 py-8 space-y-6" data-division-page={division.id}>
      <header>
        <Link href={`${base}/divisions`} className="text-sm font-medium text-brand-fg hover:underline">
          ← All divisions
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-primary break-words">{division.name}</h1>
        <p className="mt-1 text-sm text-tertiary">{[division.seasonLabel, sport, division.ageBand, division.genderStream, division.tier].filter(Boolean).join(' · ')}</p>
      </header>

      {/* G4: the division's next game leads the page. */}
      {nextGameOf(schedule) && (
        <section aria-label="Next game" data-division-next-game="">
          <NextGameCard game={nextGameOf(schedule)} variant="banner" />
        </section>
      )}

      <section aria-label="Teams" className={card}>
        <h2 className="text-lg font-semibold text-primary">Teams</h2>
        {teams.length === 0 ? (
          <p className="mt-1 text-sm text-tertiary">No teams entered yet.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {teams.map(t => (
              <Link key={t.id} href={`${base}/teams/${t.id}`} className="inline-flex items-center gap-2 rounded-full border border-border bg-canvas px-3 py-1 text-sm font-medium text-primary">
                {t.primaryColor && <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: t.primaryColor }} />}
                {t.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Standings" className="space-y-4">
        {withRows.length === 0 ? (
          <div className={card}>
            <h2 className="text-lg font-semibold text-primary">Standings</h2>
            <p className="mt-1 text-sm text-tertiary">No published standings yet.</p>
          </div>
        ) : (
          withRows.map(comp => <PublicStandingsTable key={comp.id} competition={comp} basePath={base} />)
        )}
      </section>

      <section aria-label="Upcoming" className={card}>
        <h2 className="text-lg font-semibold text-primary">Upcoming</h2>
        <TeamScheduleList items={schedule.upcoming} empty="Nothing on the schedule yet." />
      </section>

      <section aria-label="Results" className={card}>
        <h2 className="text-lg font-semibold text-primary">Results</h2>
        <TeamScheduleList items={schedule.results} empty="No results yet." />
      </section>

      {divisionNews.length > 0 && (
        <section aria-label="Division news" className={card} data-division-news="">
          <h2 className="text-lg font-semibold text-primary">News</h2>
          <NewsItems posts={divisionNews} siteId={site.id} basePath={base} />
        </section>
      )}
    </div>
  );
}
