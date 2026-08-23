'use client';

// Course result tile (explore's Courses section) — the composer dropdown's
// row pattern, promoted to a card, plus the course logo (logo.dev via the
// course website's domain; initial-letter tile when absent — a supported
// state, not a degraded one).

import type { GolfCourse } from '@/types/golf';
import BrandLogo from '@/components/BrandLogo';
import { websiteDomain } from '@/lib/logo-dev';

export default function CourseCard({
  course,
  onClick,
  expanded = false,
}: {
  course: GolfCourse;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const location = [course.city, course.state].filter(Boolean).join(', ');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className={`w-full text-left bg-surface rounded-lg border p-4 transition-all hover:shadow-md hover:border-violet-300 dark:hover:border-violet-700 ${
        expanded ? 'border-violet-400 dark:border-violet-600' : 'border-border'
      }`}
    >
      <div className="flex items-start gap-3">
        <BrandLogo domain={websiteDomain(course.website) ?? undefined} name={course.name} size={40} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-primary truncate">{course.name}</div>
          {location && <div className="text-sm text-tertiary truncate">{location}</div>}
          <div className="text-xs text-muted mt-1">
            {course.holes.length > 0
              ? `Par ${course.totalPar} • ${course.holes.length} holes`
              : 'Tap for details'}
          </div>
        </div>
        <i
          className={`fas fa-chevron-${expanded ? 'up' : 'down'} text-xs text-faint mt-1`}
          aria-hidden="true"
        ></i>
      </div>
    </button>
  );
}
