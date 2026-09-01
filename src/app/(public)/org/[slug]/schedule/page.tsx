import type { Metadata } from 'next';
import { getCachedSchedule, getCachedSite } from '@/lib/org-sites/cached';
import ScheduleList from '../_components/ScheduleList';
import { requireSiteModule } from '../_components/require-module';

// ── /org/[slug]/schedule — the full schedule subpage (phase 3 R2) ──────────
// The one canonical cached schedule entry (25 upcoming events across the
// org, its divisions, and its teams); the home page slices the same
// entry. Module disabled → notFound.

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
  const canonical = `/org/${site.subdomain}/schedule`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: ['/og-image.png'] },
  };
}

export default async function OrgSiteSchedulePage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'schedule');
  const events = await getCachedSchedule(slug, site.side, site.orgId);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">Schedule</h1>
      <section
        aria-label="Upcoming events"
        className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      >
        {events && events.length > 0 ? (
          <ScheduleList events={events} />
        ) : (
          <p className="text-sm text-tertiary">No upcoming events.</p>
        )}
      </section>
    </div>
  );
}
