import type { Metadata } from 'next';
import { getCachedCourses, getCachedSite } from '@/lib/org-sites/cached';
import { buildCoursesJsonLd, safeJsonLd } from '@/lib/org-sites/jsonld';
import CoursesList from '../_components/CoursesList';
import { requireSiteModule } from '../_components/require-module';
import { siteBasePath, siteAbsoluteUrl } from '@/lib/org-sites/urls';

// ── /org/[slug]/courses — the golf club's courses subpage (phase 6b A2) ──
// Every catalog course linked to the org's venues, with its tee sheet.
// Module disabled → notFound (disabled modules don't exist).

export const revalidate = 300;

// The ISR-eligibility rule (see the home page): every page under the
// dynamic segment needs its own generateStaticParams or it silently
// becomes plain SSR.
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
  const title = `${site.orgName} Courses`;
  const description = `Courses, tee sheets and ratings at ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/courses`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteCoursesPage({ params }: PageParams) {
  const { slug } = await params;
  const site = await requireSiteModule(slug, 'courses');
  const courses = await getCachedCourses(slug, site.side, site.orgId);
  const jsonLd = buildCoursesJsonLd(site, courses);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      {jsonLd && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      )}
      <h1 className="text-2xl font-bold text-primary">Courses</h1>
      {courses.length === 0 ? (
        <p className="text-sm text-tertiary">No courses listed yet.</p>
      ) : (
        <CoursesList courses={courses} detailed basePath={siteBasePath(site)} />
      )}
    </div>
  );
}
