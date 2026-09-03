import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCachedCoursePage, getCachedCourseStats, getCachedSite } from '@/lib/org-sites/cached';
import { buildCourseJsonLd, safeJsonLd } from '@/lib/org-sites/jsonld';
import { parseCoursePhotos } from '@/lib/org-sites/validate';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { courseDisplayName, courseTeeOptions, teeLabel } from '@/lib/golf/tees';
import { holeYards } from '@/lib/golf/hole-svg';
import CourseScorecardTable from '@/components/golf/CourseScorecardTable';
import { requireSiteModule } from '../../_components/require-module';
import { CourseOverview, GeometryAttribution, HoleDiagram } from '../../_components/HoleMap';
import { placeLine, sectionLabel, teeSummary } from '../../_components/CoursesList';
import CourseStatsCard from '../../_components/CourseStatsCard';
import MembersOnlyPanel from '../../_components/MembersOnlyPanel';
import { appBaseUrl, siteAbsoluteUrl, siteBasePath } from '@/lib/org-sites/urls';

// ── /org/[slug]/courses/[courseId] — the FULL course page (phase 6e S2) ────
// A golf club's course, as its own website would show it: the photo, the
// section (a named nine at a multi-course club), rating/slope per tee,
// the scorecard, a hole-by-hole table with a diagram per hole (the
// cached OSM line — no tiles, no client JS), an overview, phone /
// website / directions, the sibling layouts, and GolfCourse structured
// data. The reader is the org's own course list, so a foreign or unknown
// id 404s indistinguishably. Module disabled → notFound.

export const revalidate = 300;

// Both dynamic params ride the ISR-eligibility rule (the team page's).
export function generateStaticParams(): { slug: string; courseId: string }[] {
  return [];
}

interface PageParams {
  params: Promise<{ slug: string; courseId: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug, courseId } = await params;
  const site = await getCachedSite(slug);
  if (!site || !UUID_RE.test(courseId)) return { title: 'Not found' };
  const page = await getCachedCoursePage(slug, site.side, site.orgId, courseId);
  if (!page) return { title: 'Not found' };
  const name = courseDisplayName(page.course.clubName, page.course.name);
  const title = `${name} — ${site.orgName}`;
  const description = [
    page.course.holesCount ? `${page.course.holesCount} holes` : null,
    page.course.totalPar ? `par ${page.course.totalPar}` : null,
    placeLine(page.course) || null,
  ]
    .filter(Boolean)
    .join(' · ');
  const canonical = `${siteAbsoluteUrl(site)}/courses/${courseId}`;
  return {
    title,
    description: description ? `${name}: ${description}. Scorecard, tees and hole maps on Edge Athlete.` : `${name} on Edge Athlete.`,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

export default async function OrgSiteCoursePage({ params }: PageParams) {
  const { slug, courseId } = await params;
  const site = await requireSiteModule(slug, 'courses');
  if (!UUID_RE.test(courseId)) notFound();
  const page = await getCachedCoursePage(slug, site.side, site.orgId, courseId);
  if (!page) notFound();

  const { course, venueName, phone, siblings, geometry } = page;
  // S3: the course fills itself — members' public rounds here (par per
  // hole from the catalog fills a holes row that carries none).
  const stats = await getCachedCourseStats(
    slug,
    site.side,
    site.orgId,
    course.id,
    new Map((course.holes ?? []).filter(h => h.par > 0).map(h => [h.number, h.par]))
  );
  const name = courseDisplayName(course.clubName, course.name);
  const base = siteBasePath(site);
  const photo = parseCoursePhotos(site.modules.find(m => m.module_key === 'courses')?.config)[course.id];
  const photoUrl = photo?.path ? orgMediaUrl(site.id, photo.path) : null;
  // N6: per-hole photos ride the same config entry.
  const holePhotos = photo?.holes ?? {};
  const hasHolePhotos = Object.keys(holePhotos).length > 0;
  const tees = teeSummary(course);
  const holes = [...(course.holes ?? [])].sort((a, b) => a.number - b.number);
  const yardTees = courseTeeOptions(course).filter(tee => holes.some(h => typeof h.yardage?.[tee] === 'number'));
  const lineByHole = new Map((geometry?.holes ?? []).map(h => [h.hole, h]));
  const section = sectionLabel(course);
  const directions =
    typeof course.lat === 'number' && typeof course.lng === 'number'
      ? `https://www.google.com/maps/search/?api=1&query=${course.lat},${course.lng}`
      : null;
  const meta = [
    venueName,
    placeLine(course) || null,
    course.holesCount ? `${course.holesCount} holes` : null,
    course.totalPar ? `par ${course.totalPar}` : null,
  ].filter(Boolean);
  const built = [
    course.architect ? `Designed by ${course.architect}` : null,
    course.yearBuilt ? `est. ${course.yearBuilt}` : null,
    course.courseType ?? null,
  ].filter(Boolean);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(buildCourseJsonLd(site, { course, phone }, `${siteAbsoluteUrl(site)}/courses/${course.id}`)),
        }}
      />
      <header>
        <p className="text-xs text-muted">
          <Link href={`${base}/courses`} className="text-brand-fg">
            Courses
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-bold text-primary">{name}</h1>
        {section && <p className="mt-1 text-sm font-medium text-secondary">{section}</p>}
        <p className="mt-1 text-sm text-tertiary">{meta.join(' · ')}</p>
        {built.length > 0 && <p className="mt-1 text-xs text-tertiary">{built.join(' · ')}</p>}
        <p className="mt-2 text-xs text-tertiary">{`Home of ${site.orgName}`}</p>
      </header>

      {photoUrl && (
        <div className="relative w-full aspect-[16/9] overflow-hidden rounded-lg bg-surface-sunken">
          {/* The streamer is never optimizer-eligible → unoptimized. */}
          <Image src={photoUrl} alt={photo?.alt ?? ''} fill unoptimized sizes="(max-width: 896px) 100vw, 896px" className="object-cover" />
        </div>
      )}

      <section aria-label="Contact and directions" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {phone && (
            <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="text-brand-fg font-medium">
              {phone}
            </a>
          )}
          {course.website && /^https:\/\//.test(course.website) && (
            <a href={course.website} rel="noopener noreferrer" target="_blank" className="text-brand-fg font-medium">
              Website<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          {directions && (
            <a href={directions} rel="noopener noreferrer" target="_blank" className="text-brand-fg font-medium">
              Directions →<span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
          <a href={`${appBaseUrl()}/explore?course=${encodeURIComponent(course.id)}`} className="text-brand-fg font-medium">
            View on map →
          </a>
        </p>
        {course.description && (
          <>
            <p className="mt-3 text-sm text-secondary leading-relaxed">{course.description}</p>
            {course.descriptionAttribution && (
              <p className="mt-1 text-[10px] text-faint">{course.descriptionAttribution}</p>
            )}
          </>
        )}
      </section>

      <section aria-label="Scorecard" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-primary">Scorecard</h2>
        {tees.length > 0 && (
          <p className="mt-2 text-xs text-secondary">
            <span className="font-semibold text-primary">Rating / slope:</span> {tees.join(' · ')}
          </p>
        )}
        {holes.length > 0 ? (
          <div className="mt-3">
            <CourseScorecardTable course={course} />
          </div>
        ) : (
          <p className="mt-2 text-sm text-tertiary">Hole data is not in the catalog yet.</p>
        )}
      </section>

      {(holes.length > 0 || (geometry && geometry.holes.length > 0)) && (
        <section aria-label="Hole by hole" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary">Hole by hole</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Hole</th>
                  <th scope="col" className="py-1.5 px-2 font-medium text-right">Par</th>
                  <th scope="col" className="py-1.5 px-2 font-medium text-right" aria-label="Stroke index" title="Stroke index">HCP</th>
                  {yardTees.map(tee => (
                    <th key={tee} scope="col" className="py-1.5 px-2 font-medium text-right">
                      {teeLabel(tee)}
                    </th>
                  ))}
                  {lineByHole.size > 0 && <th scope="col" className="py-1.5 pl-2 font-medium">Map</th>}
                  {hasHolePhotos && <th scope="col" className="py-1.5 pl-2 font-medium">Photo</th>}
                </tr>
              </thead>
              <tbody>
                {(holes.length > 0 ? holes : [...lineByHole.values()].map(l => ({ number: l.hole, par: l.par ?? 0, handicap: 0, yardage: {} as Record<string, number> }))).map(h => {
                  const line = lineByHole.get(h.number);
                  return (
                    <tr key={h.number} className="border-t border-border-subtle align-middle">
                      <td className="py-1.5 pr-3 font-medium text-primary">{h.number}</td>
                      <td className="py-1.5 px-2 text-right text-secondary">{h.par > 0 ? h.par : (line?.par ?? '—')}</td>
                      <td className="py-1.5 px-2 text-right text-secondary">{h.handicap > 0 ? h.handicap : '—'}</td>
                      {yardTees.map(tee => (
                        <td key={tee} className="py-1.5 px-2 text-right text-secondary">
                          {typeof h.yardage?.[tee] === 'number' ? h.yardage[tee] : '—'}
                        </td>
                      ))}
                      {lineByHole.size > 0 && (
                        <td className="py-1.5 pl-2">
                          {line ? (
                            <span className="inline-flex items-center gap-2">
                              <HoleDiagram hole={line} size={72} />
                              {holeYards(line) ? <span className="text-xs text-muted">≈ {holeYards(line)} yds</span> : null}
                            </span>
                          ) : (
                            <span className="text-xs text-faint">—</span>
                          )}
                        </td>
                      )}
                      {hasHolePhotos && (
                        <td className="py-1.5 pl-2">
                          {holePhotos[h.number] && orgMediaUrl(site.id, holePhotos[h.number].path) ? (
                            <Image
                              src={orgMediaUrl(site.id, holePhotos[h.number].path) ?? ''}
                              alt={holePhotos[h.number].alt ?? `Hole ${h.number}`}
                              width={96}
                              height={54}
                              unoptimized
                              className="h-14 w-24 rounded object-cover border border-border"
                              data-hole-photo={h.number}
                            />
                          ) : (
                            <span className="text-xs text-faint">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {geometry && (
            <div className="mt-4 space-y-2">
              <h3 className="text-sm font-semibold text-primary">Course overview</h3>
              <CourseOverview geometry={geometry} />
              <GeometryAttribution source={geometry.source} />
            </div>
          )}
        </section>
      )}

      {/* Phase 9 V4: a private club's member round stats are members-only. */}
      {site.visibility === 'private' ? <MembersOnlyPanel site={site} what="Course stats" /> : <CourseStatsCard stats={stats} />}

      {siblings.length > 0 && (
        <section aria-label="Other layouts" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary">Other layouts at {course.clubName ?? venueName}</h2>
          <ul className="mt-2 space-y-1">
            {siblings.map(s => (
              <li key={s.id} className="text-sm">
                <Link href={`${base}/courses/${s.id}`} className="text-brand-fg font-medium">
                  {s.sectionName ?? s.name}
                </Link>
                {s.sectionKind === 'nine' ? <span className="text-muted"> · 9 holes</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
