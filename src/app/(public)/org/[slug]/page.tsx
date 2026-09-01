import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCachedAffiliations,
  getCachedSchedule,
  getCachedSite,
  getCachedStaff,
  getCachedStandings,
  getCachedTeams,
  getCachedVenues,
} from '@/lib/org-sites/cached';
import { MODULE_TITLES } from '@/lib/org-sites/validate';
import AffiliationsList from './_components/AffiliationsList';
import ScheduleList from './_components/ScheduleList';
import StaffList from './_components/StaffList';
import StandingsPreview from './_components/StandingsPreview';
import TeamsList from './_components/TeamsList';
import VenuesList from './_components/VenuesList';

// ── The site home (phase 3 R2) — live modules in sort order ────────────────
// R2 replaced R1's stubs with the live-data modules; R3 replaces the hero
// placeholder with hero_config and gives sponsors/contact their editors
// (their stubs stay until then). The section list itself IS the product
// surface: enabled modules render (empty ones say so quietly), disabled
// ones don't exist. All data arrives through the per-module cached
// readers — one Promise.all, no per-component fetching.

export const revalidate = 300;

// The App Router ISR rule: a dynamic segment is only ISR-ELIGIBLE when
// generateStaticParams exists — an empty list prerenders nothing at
// build (no build-time DB/service-key needed) while making every
// runtime-rendered slug cacheable under `revalidate`. Without this the
// route is plain on-demand SSR and x-vercel-cache never leaves MISS
// (measured on prod, Sep 1).
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
  return {
    title: site.orgName,
    description: `${site.orgName} on Edge Athlete — schedule, standings, and teams.`,
  };
}

export default async function OrgSiteHome({ params }: PageParams) {
  const { slug } = await params;
  const site = await getCachedSite(slug);
  if (!site) notFound();

  const enabled = site.modules.filter(m => m.enabled);
  const has = (key: string) => enabled.some(m => m.module_key === key);
  const { side, orgId } = site;

  const [standings, events, teams, staff, venues, affiliations] = await Promise.all([
    has('standings') ? getCachedStandings(slug, side, orgId) : Promise.resolve(null),
    has('schedule') ? getCachedSchedule(slug, side, orgId) : Promise.resolve(null),
    has('teams') ? getCachedTeams(slug, side, orgId) : Promise.resolve([]),
    has('staff') ? getCachedStaff(slug, side, orgId) : Promise.resolve([]),
    has('venues') ? getCachedVenues(slug, side, orgId) : Promise.resolve([]),
    has('affiliations') ? getCachedAffiliations(slug, side, orgId) : Promise.resolve([]),
  ]);

  const empty = (text: string) => <p className="mt-1 text-sm text-tertiary">{text}</p>;

  const moduleBody = (key: string) => {
    switch (key) {
      case 'standings':
        return <StandingsPreview standings={standings} slug={site.subdomain} />;
      case 'schedule':
        return events && events.length > 0 ? (
          <>
            <ScheduleList events={events.slice(0, 5)} />
            <Link
              href={`/org/${site.subdomain}/schedule`}
              className="mt-3 inline-block text-sm text-brand-fg font-medium"
            >
              Full schedule →
            </Link>
          </>
        ) : (
          empty('No upcoming events.')
        );
      case 'teams':
        return teams.length > 0 ? (
          <>
            <TeamsList teams={teams.slice(0, 12)} slug={site.subdomain} />
            <Link
              href={`/org/${site.subdomain}/teams`}
              className="mt-3 inline-block text-sm text-brand-fg font-medium"
            >
              All teams →
            </Link>
          </>
        ) : (
          empty('No teams yet.')
        );
      case 'staff':
        return staff.length > 0 ? <StaffList staff={staff} /> : empty('No staff listed yet.');
      case 'venues':
        return venues.length > 0 ? <VenuesList venues={venues} /> : empty('No venues listed yet.');
      case 'affiliations':
        return affiliations.length > 0 ? (
          <AffiliationsList affiliations={affiliations} />
        ) : (
          empty('No affiliations yet.')
        );
      default:
        // sponsors + contact: R3 ships their editors; the stub stays.
        return empty('Coming soon.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {has('hero') && (
        <section
          aria-label="Welcome"
          className="rounded-xl bg-gradient-to-r from-violet-500 to-violet-600 px-6 py-10 text-white"
        >
          <h1 className="text-2xl sm:text-3xl font-bold">{site.orgName}</h1>
          <p className="mt-1 text-sm opacity-90">Schedules, standings, and teams — live.</p>
        </section>
      )}
      {enabled
        .filter(m => m.module_key !== 'hero')
        .map(m => (
          <section
            key={m.module_key}
            aria-label={MODULE_TITLES[m.module_key] ?? m.module_key}
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary">
              {MODULE_TITLES[m.module_key] ?? m.module_key}
            </h2>
            {moduleBody(m.module_key)}
          </section>
        ))}
    </div>
  );
}
