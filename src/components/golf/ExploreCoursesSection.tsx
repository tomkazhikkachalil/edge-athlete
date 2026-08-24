'use client';

// /explore's Golf Courses section (renders only when the golf chip is
// selected). Guest-safe by construction: GET /api/golf/courses needs no auth
// and explore is an anonymous surface. Local catalog only — worldwide
// provider search (?global=1) stays a composer-button behavior, never
// browse-page typing. Owns its own loading state so course typing never
// flashes the athletes grid.
//
// Location (migration 104): Country → Region selects fed by the facets
// endpoint (with counts), and Near me — one getCurrentPosition, no
// tracking — which sorts the catalog by distance and puts a km chip on each
// card. `initialCourseId` opens one card expanded (the header search's
// course results deep-link here: there is no course page).

import { useEffect, useState } from 'react';
import type { GolfCourse } from '@/types/golf';
import CourseCard from '@/components/golf/CourseCard';
import CourseInfoCard from '@/components/golf/CourseInfoCard';
import LogoDevAttribution from '@/components/LogoDevAttribution';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';

const LIMIT = 12;
const NEAR_RADIUS_KM = 100;

interface Facet {
  country: string | null;
  countryCode: string;
  region: string | null;
  regionCode: string | null;
  count: number;
}

interface CourseFilters {
  country: string;
  region: string;
  near: { lat: number; lng: number } | null;
}

export default function ExploreCoursesSection({ initialCourseId = null }: { initialCourseId?: string | null }) {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CourseFilters>({ country: '', region: '', near: null });
  const [countries, setCountries] = useState<Facet[]>([]);
  const [regions, setRegions] = useState<Facet[]>([]);
  const [courses, setCourses] = useState<GolfCourse[]>([]);
  const [attribution, setAttribution] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false); // 429 — quiet inline row, no console noise
  const [nearError, setNearError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(initialCourseId);

  // Pure fetch (no setState — set-state-in-effect wants state applied in
  // async continuations, the explore page's own inlined-IIFE shape).
  const loadCourses = async (
    signal: AbortSignal,
    q: string,
    f: CourseFilters,
    pinnedId: string | null
  ): Promise<{ courses: GolfCourse[]; attribution: string | null } | 'busy' | null> => {
    try {
      const params = new URLSearchParams({ q, limit: String(LIMIT) });
      if (f.country) params.set('country', f.country);
      if (f.region) params.set('region', f.region);
      if (f.near) {
        params.set('near', `${f.near.lat},${f.near.lng}`);
        params.set('radius', String(NEAR_RADIUS_KM));
      }
      const res = await fetch(`/api/golf/courses?${params}`, { credentials: 'include', signal });
      if (res.status === 429) return 'busy';
      if (!res.ok) return null;
      const data = await res.json();
      let list = (data.courses as GolfCourse[]) ?? [];
      // A deep-linked course must be on the page even if the browse head
      // doesn't include it: fetch it by id and pin it first.
      if (pinnedId && !list.some(c => c.id === pinnedId)) {
        const one = await fetch(`/api/golf/courses?id=${encodeURIComponent(pinnedId)}`, { credentials: 'include', signal });
        if (one.ok) {
          const course = (await one.json()).course as GolfCourse | undefined;
          if (course) list = [course, ...list];
        }
      }
      return { courses: list, attribution: (data.attribution as string | null) ?? null };
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

  const [runSearch] = useDebouncedCallback(async (signal: AbortSignal, q: string, f: CourseFilters) => {
    try {
      apply(await loadCourses(signal, q, f, null));
    } catch {
      /* aborted — a newer query took over */
    }
  });

  // Initial browse (empty query = catalog head, or the deep-linked course
  // pinned first) — no debounce needed. Re-runs when the filters change.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      try {
        const result = await loadCourses(controller.signal, query.trim(), filters, initialCourseId);
        if (!cancelled) apply(result);
      } catch {
        /* aborted on unmount */
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Filters/deep link drive this; typing goes through the debounced path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, initialCourseId]);

  // Facets: countries once, regions per selected country. Empty until the
  // migration is live — a designed state (the selects just stay short).
  useEffect(() => {
    let cancelled = false;
    fetch('/api/golf/courses/facets', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { facets: [] }))
      .then(b => {
        if (!cancelled) setCountries((b.facets as Facet[]) ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!filters.country) return;
    let cancelled = false;
    fetch(`/api/golf/courses/facets?country=${encodeURIComponent(filters.country)}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { facets: [] }))
      .then(b => {
        if (!cancelled) setRegions((b.facets as Facet[]) ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [filters.country]);

  const onQueryChange = (value: string) => {
    setQuery(value);
    setExpandedId(null);
    setLoading(true);
    // Every keystroke reschedules through the SAME debounced path — a
    // cleared box debounces back to the catalog browse, so no early-return
    // ever leaves an armed timer (the documented useDebouncedCallback trap).
    runSearch(value.trim(), filters);
  };

  const setCountry = (country: string) => {
    setRegions([]);
    setExpandedId(null);
    setLoading(true);
    setFilters(f => ({ ...f, country, region: '' }));
  };
  const setRegion = (region: string) => {
    setExpandedId(null);
    setLoading(true);
    setFilters(f => ({ ...f, region }));
  };
  const toggleNearMe = () => {
    if (filters.near) {
      setLoading(true);
      setFilters(f => ({ ...f, near: null }));
      return;
    }
    if (!('geolocation' in navigator)) {
      setNearError('Location is not available on this device.');
      return;
    }
    setNearError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        setExpandedId(null);
        setLoading(true);
        setFilters(f => ({ ...f, near: { lat: pos.coords.latitude, lng: pos.coords.longitude } }));
      },
      () => setNearError('Could not get your location — allow it in the browser, or pick a country and region.'),
      { maximumAge: 300_000, timeout: 10_000 }
    );
  };

  const hasFilter = Boolean(query.trim() || filters.country || filters.near);

  return (
    <section aria-labelledby="explore-courses" className="mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 id="explore-courses" className="text-h3 font-bold text-primary">
          Golf Courses
        </h2>
        <div className="relative w-full sm:w-80">
          <i
            className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-faint text-sm"
            aria-hidden="true"
          ></i>
          <input
            type="search"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder="Course, club, city, region or country"
            aria-label="Search golf courses"
            className="w-full min-h-[44px] rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-primary placeholder:text-faint"
          />
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          aria-label="Country"
          value={filters.country}
          onChange={e => setCountry(e.target.value)}
          className="min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary"
        >
          <option value="">All countries</option>
          {countries.map(f => (
            <option key={f.countryCode} value={f.countryCode}>
              {f.country ?? f.countryCode} ({f.count.toLocaleString()})
            </option>
          ))}
        </select>
        <select
          aria-label="Region"
          value={filters.region}
          onChange={e => setRegion(e.target.value)}
          disabled={!filters.country || regions.length === 0}
          className="min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary disabled:opacity-50"
        >
          <option value="">{filters.country ? 'All regions' : 'Region'}</option>
          {regions.map(f => (
            <option key={f.regionCode ?? f.region ?? ''} value={f.regionCode ?? ''}>
              {f.region ?? f.regionCode} ({f.count.toLocaleString()})
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={!!filters.near}
          onClick={toggleNearMe}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-4 text-sm font-medium ea-interactive ${
            filters.near ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-brand-fg'
          }`}
        >
          <i className="fas fa-location-crosshairs" aria-hidden="true"></i>
          Near me
        </button>
      </div>
      {nearError && <p className="mb-3 text-xs text-tertiary">{nearError}</p>}
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
          <p>No courses found{query ? ` for “${query.trim()}”` : hasFilter ? ' here' : ' yet'}.</p>
          <p className="mt-1 text-xs text-faint">Try a city, province or country — or the course&apos;s club name.</p>
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
