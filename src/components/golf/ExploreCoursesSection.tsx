'use client';

// /explore's Golf Courses section (renders only when the golf chip is
// selected). Guest-safe by construction: GET /api/golf/courses needs no auth
// and explore is an anonymous surface. Local catalog only — worldwide
// provider search (?global=1) stays a composer-button behavior, never
// browse-page typing. Owns its own loading state so course typing never
// flashes the athletes grid.

import { useEffect, useState } from 'react';
import type { GolfCourse } from '@/types/golf';
import CourseCard from '@/components/golf/CourseCard';
import CourseInfoCard from '@/components/golf/CourseInfoCard';
import LogoDevAttribution from '@/components/LogoDevAttribution';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';

const LIMIT = 12;

export default function ExploreCoursesSection() {
  const [query, setQuery] = useState('');
  const [courses, setCourses] = useState<GolfCourse[]>([]);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); // 429 — quiet inline row, no console noise
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Pure fetch (no setState — set-state-in-effect wants state applied in
  // async continuations, the explore page's own inlined-IIFE shape).
  const loadCourses = async (
    signal: AbortSignal,
    q: string
  ): Promise<{ courses: GolfCourse[]; attribution: string | null } | 'busy' | null> => {
    try {
      const res = await fetch(`/api/golf/courses?q=${encodeURIComponent(q)}&limit=${LIMIT}`, {
        credentials: 'include',
        signal,
      });
      if (res.status === 429) return 'busy';
      if (!res.ok) return null;
      const data = await res.json();
      return {
        courses: (data.courses as GolfCourse[]) ?? [],
        attribution: (data.attribution as string | null) ?? null,
      };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      return null;
    }
  };

  const apply = (result: Awaited<ReturnType<typeof loadCourses>>) => {
    if (result === 'busy') {
      setBusy(true);
    } else {
      setBusy(false);
      setCourses(result?.courses ?? []);
      if (result) setAttribution(result.attribution);
    }
    setLoading(false);
  };

  const [runSearch] = useDebouncedCallback(async (signal: AbortSignal, q: string) => {
    try {
      apply(await loadCourses(signal, q));
    } catch {
      /* aborted — a newer query took over */
    }
  });

  // Initial browse (empty query = catalog head) — no debounce needed.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const result = await loadCourses(controller.signal, '');
        if (!cancelled) apply(result);
      } catch {
        /* aborted on unmount */
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Mount-only browse; typing goes through the debounced path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    setExpandedId(null);
    setLoading(true);
    // Every keystroke reschedules through the SAME debounced path — a
    // cleared box debounces back to the catalog browse, so no early-return
    // ever leaves an armed timer (the documented useDebouncedCallback trap).
    runSearch(value.trim());
  };

  return (
    <section aria-labelledby="explore-courses" className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 id="explore-courses" className="text-h3 font-bold text-primary">
          Golf Courses
        </h2>
        <div className="relative w-full sm:w-72">
          <i
            className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-faint text-sm"
            aria-hidden="true"
          ></i>
          <input
            type="search"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Search golf courses"
            aria-label="Search golf courses"
            className="w-full min-h-[44px] rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-primary placeholder:text-faint"
          />
        </div>
      </div>
      {busy && (
        <p className="mb-3 text-xs text-tertiary">
          Course search is busy — give it a few seconds and try again.
        </p>
      )}
      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-24 animate-pulse bg-surface rounded-lg border border-border" />
          ))}
        </div>
      ) : courses.length === 0 ? (
        <div className="bg-surface rounded-lg border border-border p-8 text-center text-muted">
          <i
            className="fas fa-golf-ball-tee text-3xl text-gray-300 dark:text-stone-600 mb-3"
            aria-hidden="true"
          ></i>
          <p>No courses found{query ? ` for “${query.trim()}”` : ' yet'}.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* min-w-0 on each grid item is load-bearing: an item's automatic
              minimum is its content width, so without it the scorecard table
              widens the PAGE instead of scrolling inside its own wrapper. */}
          {courses.map(course => (
            <div key={course.id} className={`min-w-0 ${expandedId === course.id ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
              <CourseCard
                course={course}
                expanded={expandedId === course.id}
                onClick={() => setExpandedId(prev => (prev === course.id ? null : course.id))}
              />
              {expandedId === course.id && <CourseInfoCard course={course} />}
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-[10px] text-faint">
        {attribution && <span className="mr-2">{attribution}</span>}
        <LogoDevAttribution />
      </p>
    </section>
  );
}
