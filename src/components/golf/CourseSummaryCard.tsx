'use client';

import { COPY } from '@/lib/copy';
import { courseSummary, mappingGaps, type MappingGap } from '@/lib/golf/course-summary';
import { courseOverview } from '@/lib/golf/hole-svg';
import type { HoleLine } from '@/lib/golf/hole-geometry';
import { teeLabel } from '@/lib/golf/tees';
import type { GolfCourse } from '@/types/golf';

// ── The course at a glance (course flow fixes M3, Oct 2026) ─────────────────
// Tom: "a bold summary card at the top of a course: hole count, total yardage
// per tee, slope and rating, a map thumbnail labelled 'View course map',
// large high-contrast type — and an explicit 'Not fully mapped' state".
// No hooks: the host (CourseInfoCard) owns the fetches and hands the facts
// down. The thumbnail is the pure course overview SVG (hole-svg.ts) — no
// Leaflet until the map itself is asked for.

export interface CourseSummaryCardProps {
  course: GolfCourse;
  /** The cached OSM lines: undefined = not asked yet, null = asked, none. */
  holeLines: HoleLine[] | null | undefined;
  /** PR 3: the course has drawn greens but no lines. */
  greensOnly?: boolean;
  /** PR 4: the club's unlabelled nines, when the geometry stores sections. */
  sections?: number;
  teeInPlay?: string | null;
  /** Opens the real map; absent → no thumbnail button (no coordinates). */
  onViewMap?: () => void;
  /** The facts are still loading (a thin row's detail call) — never flash
   *  "Not fully mapped" before the answer. */
  loading?: boolean;
}

const gapCopy = (gap: MappingGap, teeInPlay?: string | null, sections = 0): string =>
  gap === 'no-hole-data'
    ? COPY.GOLF_COURSE.GAP_NO_HOLE_DATA
    : gap === 'no-yardage-for-tee'
      ? COPY.GOLF_COURSE.GAP_NO_YARDAGE(teeLabel(teeInPlay ?? ''))
      : gap === 'greens-only'
        ? COPY.GOLF_COURSE.GAP_GREENS_ONLY
        : gap === 'pick-a-nine'
          ? COPY.GOLF_COURSE.GAP_PICK_NINE(sections)
          : COPY.GOLF_COURSE.GAP_NO_LINES;

export default function CourseSummaryCard({ course, holeLines, greensOnly = false, sections = 0, teeInPlay, onViewMap, loading = false }: CourseSummaryCardProps) {
  const summary = courseSummary(course, teeInPlay);
  const gaps = loading ? [] : mappingGaps({ holes: course.holes, teeInPlay, geometry: holeLines, greensOnly, sections });
  const thumb = holeLines && holeLines.length > 0 ? courseOverview(holeLines, 100, 8) : null;
  const totals = summary.tees.filter(t => t.yards != null);

  if (loading) {
    return <div className="mb-3 h-[72px] animate-pulse rounded-lg bg-surface" data-course-summary="loading" />;
  }

  return (
    <div className="mb-3 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3" data-course-summary="">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {summary.holeCount != null && (
            <span className="text-3xl font-black tabular-nums leading-none text-primary">{COPY.GOLF_COURSE.HOLES(summary.holeCount)}</span>
          )}
          {summary.par != null && (
            <span className="text-3xl font-black tabular-nums leading-none text-primary">{COPY.GOLF_COURSE.PAR(summary.par)}</span>
          )}
        </div>
        {totals.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-sm text-secondary" data-course-tees="">
            {totals.map(t => (
              <li key={t.key} className={t.key === teeInPlay ? 'font-bold text-primary' : ''}>
                {t.label} <span className="font-bold tabular-nums text-primary">{t.yards!.toLocaleString()} yds</span>
                {t.rating != null && t.slope != null && <span className="text-tertiary"> · {t.rating} / {t.slope}</span>}
              </li>
            ))}
          </ul>
        )}
        {gaps.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-course-unmapped="">
            <span className="rounded-full bg-surface-muted px-2 py-0.5 font-black uppercase tracking-wide text-primary">{COPY.GOLF_COURSE.NOT_FULLY_MAPPED}</span>
            {gaps.map(g => (
              <span key={g} className="text-secondary" data-course-gap={g}>
                {gapCopy(g, teeInPlay, sections)}
              </span>
            ))}
          </div>
        )}
      </div>
      {onViewMap && (
        <button
          type="button"
          onClick={onViewMap}
          aria-label={COPY.GOLF_COURSE.VIEW_MAP}
          data-course-map-thumb=""
          className="flex shrink-0 flex-col items-center gap-1 rounded-lg border border-border bg-surface p-1.5 ea-interactive min-w-[44px] min-h-[44px]"
        >
          {thumb ? (
            <svg viewBox={thumb.viewBox} width={72} height={72} aria-hidden="true" className="rounded bg-emerald-50 dark:bg-emerald-950/40">
              {thumb.paths.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className="text-green-700 dark:text-green-300" />
              ))}
            </svg>
          ) : (
            <span className="flex h-[72px] w-[72px] items-center justify-center rounded bg-surface-muted text-2xl text-brand-fg" aria-hidden="true">
              <i className="fas fa-map-location-dot"></i>
            </span>
          )}
          <span className="text-xs font-semibold text-brand-fg">{COPY.GOLF_COURSE.VIEW_MAP}</span>
        </button>
      )}
    </div>
  );
}
