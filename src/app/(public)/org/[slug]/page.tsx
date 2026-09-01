import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getCachedSite } from '@/lib/org-sites/cached';

// ── The site home (phase 3 R1) — module stubs in sort order ────────────────
// R2 replaces each stub with its live-data module component; R3 replaces
// the hero placeholder with hero_config. The section list itself IS the
// product surface: enabled modules render, disabled ones don't exist.

export const revalidate = 300;

const MODULE_TITLES: Record<string, string> = {
  standings: 'Standings',
  schedule: 'Schedule',
  teams: 'Teams',
  staff: 'Staff',
  venues: 'Venues',
  affiliations: 'Affiliations',
  sponsors: 'Sponsors',
  contact: 'Contact',
};

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
  const hero = enabled.some(m => m.module_key === 'hero');

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {hero && (
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
            <p className="mt-1 text-sm text-tertiary">Coming soon.</p>
          </section>
        ))}
    </div>
  );
}
