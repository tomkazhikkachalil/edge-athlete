import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCachedSite, getCachedTeamPage } from '@/lib/org-sites/cached';
import { buildTeamJsonLd, safeJsonLd } from '@/lib/org-sites/jsonld';
import { UUID_RE } from '@/lib/golf/course-catalog';
import ScheduleList from '../../_components/ScheduleList';
import { requireSiteModule } from '../../_components/require-module';

// ── /org/[slug]/teams/[teamId] — the FULL team page (phase 3 R2) ───────────
// Tom's decision 3: record row, upcoming schedule, and a MASKED roster
// (publicDisplayName — full name only for claimed public profiles). The
// reader filters by the org column, so a foreign teamId under this slug
// 404s indistinguishably. NO media until phase 4's photo-consent flag.

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
  const canonical = `/org/${site.subdomain}/teams/${teamId}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`/org/${site.subdomain}/card.png`] },
  };
}

export default async function OrgSiteTeamPage({ params }: PageParams) {
  const { slug, teamId } = await params;
  const site = await requireSiteModule(slug, 'teams');
  if (!UUID_RE.test(teamId)) notFound();
  const teamPage = await getCachedTeamPage(slug, site.side, site.orgId, teamId);
  if (!teamPage) notFound();

  const { team, records, events, roster } = teamPage;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* R4: SportsTeam structured data — the team and its org only,
          never the roster (no Person in JSON-LD, ever). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(buildTeamJsonLd(site, { id: team.id, name: team.name })),
        }}
      />
      <header>
        <h1 className="text-2xl font-bold text-primary">{team.name}</h1>
        {team.divisionLabels.length > 0 ? (
          <p className="mt-1 text-sm text-tertiary">{team.divisionLabels.join(' · ')}</p>
        ) : null}
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
        {events.length === 0 ? (
          <p className="mt-1 text-sm text-tertiary">No upcoming events.</p>
        ) : (
          <ScheduleList events={events} />
        )}
      </section>

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
