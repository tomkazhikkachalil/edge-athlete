import type { Metadata } from 'next';
import { getCachedGolfRounds, getCachedSchedule, getCachedSite } from '@/lib/org-sites/cached';
import { buildEventsJsonLd, buildGolfRoundsJsonLd, safeJsonLd } from '@/lib/org-sites/jsonld';
import ScheduleList from '../_components/ScheduleList';
import GolfRoundsSchedule from '../_components/GolfRoundsSchedule';
import { requireSiteModule } from '../_components/require-module';
import { moduleLabel, parseNavConfig } from '@/lib/org-sites/validate';
import { siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/schedule — the full schedule subpage (phase 3 R2) ──────────
// The one canonical cached schedule entry (25 upcoming events across the
// org, its divisions, and its teams); the home page slices the same
// entry. S4: a golf league's season — its play windows — leads the page,
// and a "Subscribe" link hands the whole thing to any calendar app
// (the site's own ICS feed). Module disabled → notFound.

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
  const title = `${site.orgName} Schedule`;
  const description = `Upcoming events for ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/schedule`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteSchedulePage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'schedule');
  const [events, rounds] = await Promise.all([
    getCachedSchedule(slug, site.side, site.orgId),
    getCachedGolfRounds(slug, site.side, site.orgId),
  ]);
  const absolute = siteAbsoluteUrl(site);
  const icsHttps = `${absolute}/schedule.ics`;
  const icsWebcal = icsHttps.replace(/^https:/, 'webcal:');
  const jsonLd = [
    ...(events && events.length > 0 ? buildEventsJsonLd(site, events) : []),
    ...buildGolfRoundsJsonLd(site, rounds),
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {/* R4: SportsEvent structured data (capped; no people); S4 adds the rounds. */}
      {jsonLd.length > 0 && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold text-primary">
        {moduleLabel('schedule', parseNavConfig(site.nav_config), site.side, site.sportKey)}
      </h1>
        <p className="text-sm">
          <a href={icsWebcal} className="text-brand-fg font-medium">
            Subscribe
          </a>
          <span className="text-muted"> · </span>
          <a href={icsHttps} className="text-brand-fg font-medium">
            .ics
          </a>
        </p>
      </div>
      {rounds.length > 0 && (
        <section
          aria-label="League rounds"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary">League rounds</h2>
          <GolfRoundsSchedule rounds={rounds} />
        </section>
      )}
      <section
        aria-label="Upcoming events"
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        {rounds.length > 0 && <h2 className="text-lg font-semibold text-primary">Events</h2>}
        {events && events.length > 0 ? (
          <ScheduleList events={events} />
        ) : (
          <p className="text-sm text-tertiary">No upcoming events.</p>
        )}
      </section>
    </div>
  );
}
