'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { SearchAthleteResult, SearchPostResult, SearchClubResult, SearchLeagueResult } from '@/types/search';
import type { GolfCourse } from '@/types/golf';
import { useTypeahead } from '@/hooks/useTypeahead';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/search/typeahead';
import type { GroupedFacets } from '@/lib/search/all';
import PlacePicker, { type PlaceValue } from '@/components/PlacePicker';
import { formatPlace } from '@/lib/geo/regions';

// ONE ordered result array for all three kinds. Clubs live in here even
// though they are inert (the /club/[id] route does not exist, so their rows
// do nothing) — `isNavigable` keeps the arrow keys off them.
//
// Clubs used to be separate component state written only inside `fetcher`.
// That was a real bug: nothing ever cleared them, so a stale club row
// outlived the query that produced it, a discarded out-of-order response
// still wrote them, and they were never re-served from the cache. Keeping
// every kind in the hook's array means they clear, cache and
// sequence-guard together, by construction.
type ResultItem =
  | { kind: 'athlete'; id: string; athlete: SearchAthleteResult }
  | { kind: 'course'; id: string; course: GolfCourse }
  | { kind: 'post'; id: string; post: SearchPostResult }
  | { kind: 'league'; id: string; league: SearchLeagueResult }
  | { kind: 'club'; id: string; club: SearchClubResult };

const isNavigableResult = (i: ResultItem) => i.kind !== 'club';

interface SearchFilters {
  sport?: string;
  school?: string;
  league?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Location: a picked place → athletes/clubs within 50 km of it (108). */
  place?: PlaceValue;
  /** Facet codes (search_all_facets, 112): ISO country / region. */
  country?: string;
  region?: string;
  type: 'all' | 'athletes' | 'courses' | 'posts' | 'clubs' | 'leagues';
}

const PLACE_RADIUS_KM = 50;

export default function AdvancedSearchBar() {
  const router = useRouter();
  const { user } = useAuth();
  const [showFilters, setShowFilters] = useState(false);

  // Filter state
  const [filters, setFilters] = useState<SearchFilters>({
    type: 'all'
  });

  // The advanced filters are part of the request, so they are part of the
  // cache key too — otherwise switching sport would serve the previous
  // sport's cached rows.
  const filterKey = JSON.stringify(filters);

  const fetcher = useCallback(async (q: string, signal: AbortSignal) => {
    const active: SearchFilters = JSON.parse(filterKey);
    const params = new URLSearchParams({ q });
    if (active.type !== 'all') params.append('type', active.type);
    if (active.sport) params.append('sport', active.sport);
    if (active.school) params.append('school', active.school);
    if (active.league) params.append('league', active.league);
    if (active.dateFrom) params.append('dateFrom', active.dateFrom);
    if (active.dateTo) params.append('dateTo', active.dateTo);
    if (active.place) {
      params.append('near', `${active.place.lat},${active.place.lng}`);
      params.append('radius', String(PLACE_RADIUS_KM));
    }
    if (active.country) params.append('country', active.country);
    if (active.region) params.append('region', active.region);

    const response = await fetch(`/api/search?${params}`, { signal });
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    const data = await response.json();

    const athletes = (data.results?.athletes ?? []) as SearchAthleteResult[];
    const courseRows = (data.results?.courses ?? []) as GolfCourse[];
    const posts = (data.results?.posts ?? []) as SearchPostResult[];
    const clubRows = (data.results?.clubs ?? []) as SearchClubResult[];
    const leagueRows = (data.results?.leagues ?? []) as SearchLeagueResult[];
    // Navigable kinds first so activeIndex maps to render order:
    // athletes, courses, posts, leagues, then the inert clubs.
    return [
      ...athletes.map((a): ResultItem => ({ kind: 'athlete', id: a.id, athlete: a })),
      ...courseRows.map((c): ResultItem => ({ kind: 'course', id: c.id, course: c })),
      ...posts.map((p): ResultItem => ({ kind: 'post', id: p.id, post: p })),
      ...leagueRows.map((l): ResultItem => ({ kind: 'league', id: l.id, league: l })),
      ...clubRows.map((c): ResultItem => ({ kind: 'club', id: c.id, club: c })),
    ];
  }, [filterKey]);

  // No `narrow` here, deliberately. Progressive narrowing needs a local
  // predicate that agrees with the server, and this endpoint mixes ranked
  // people with full-text posts — approximating that client-side could show
  // confidently wrong results. Exact cache hits still make backspacing
  // instant, which is the bulk of the win.
  const {
    query,
    setQuery,
    items,
    navigable,
    loading,
    failed,
    activeIndex,
    setActiveIndex,
    onKeyDown: onListKeyDown,
    reset: resetSearch,
  } = useTypeahead<ResultItem>({
    scope: `search:all:${filterKey}`,
    fetcher,
    isNavigable: isNavigableResult,
    limit: 45,
  });

  const athletes = useMemo(
    () => items.flatMap(i => (i.kind === 'athlete' ? [i.athlete] : [])),
    [items]
  );
  const courses = useMemo(
    () => items.flatMap(i => (i.kind === 'course' ? [i.course] : [])),
    [items]
  );
  const posts = useMemo(
    () => items.flatMap(i => (i.kind === 'post' ? [i.post] : [])),
    [items]
  );
  const leagues = useMemo(
    () => items.flatMap(i => (i.kind === 'league' ? [i.league] : [])),
    [items]
  );
  const clubs = useMemo(
    () => items.flatMap(i => (i.kind === 'club' ? [i.club] : [])),
    [items]
  );

  // Results show whenever something has been typed — no open/closed state.
  //
  // There used to be a `showResults` flag flipped by a hasAnything false->true
  // transition plus an outside-mousedown listener. It had a real bug (once an
  // outside click set it false, a NEW query that also had results never
  // reopened it, because there was no transition to observe), and with the
  // results inline it has nothing left to do: this component only ever renders
  // inside the ⌘K dialog, which owns its own dismissal.
  const hasQuery = query.trim().length > 0;

  const activate = useCallback((item: ResultItem) => {
    if (item.kind === 'athlete') {
      router.push(user?.id === item.athlete.id ? '/athlete' : `/athlete/${item.athlete.id}`);
    } else if (item.kind === 'course') {
      // No course page yet: Explore opens the golf chip with this card expanded.
      router.push(`/explore?course=${item.course.id}`);
    } else if (item.kind === 'post') {
      router.push(`/feed?post=${item.post.id}`);
    } else if (item.kind === 'league') {
      router.push(`/league/${item.league.id}`);
    } else {
      return; // clubs are inert
    }
    resetSearch();
  }, [router, user?.id, resetSearch]);

  // Arrow keys move, Enter opens. Escape is deliberately NOT handled here —
  // it belongs to the dialog, which closes the whole panel.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (onListKeyDown(e)) return;
    if (e.key === 'Enter' && navigable[activeIndex]) {
      e.preventDefault();
      activate(navigable[activeIndex]);
    }
  };

  const listboxId = 'ea-search-results';
  const optionId = (i: number) => `${listboxId}-option-${i}`;


  // The picker's text is separate from the pick: typing without choosing a
  // suggestion is not a filter.
  const [placeText, setPlaceText] = useState('');

  // Facet counts (search_all_facets via /api/search/facets) — fetched only
  // while the panel is open, debounced on the same cadence as the search.
  // Decoration by contract: a missing RPC or failed fetch just leaves the
  // selects plain. All setState happens inside the debounce timer (async),
  // never synchronously in the effect body.
  const [facets, setFacets] = useState<GroupedFacets | null>(null);
  useEffect(() => {
    if (!showFilters) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query });
        if (filters.type !== 'all') params.append('type', filters.type);
        if (filters.country) params.append('country', filters.country);
        const response = await fetch(`/api/search/facets?${params}`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setFacets(data.facets ?? null);
      } catch {
        /* facets are decoration */
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showFilters, query, filters.type, filters.country]);

  const typeCount = (code: string): string => {
    const n = facets?.types.find(t => t.code === code)?.n;
    return n !== undefined ? ` (${n})` : '';
  };
  const clearFilters = () => {
    setFilters({ type: 'all' });
    setPlaceText('');
  };

  const hasActiveFilters =
    filters.sport || filters.school || filters.league || filters.dateFrom || filters.dateTo || filters.place || filters.country || filters.type !== 'all';

  return (
    <div className="w-full">
      {/* Search Input */}
      <div className="relative flex items-center">
        <input
          type="text"
          name="ea-search"
          autoComplete="off"
          role="combobox"
          aria-expanded={navigable.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={navigable[activeIndex] ? optionId(activeIndex) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search athletes, courses, posts, clubs..."
          /* No focus:ring-* — focus styling is global in globals.css, and a
             local override here fought the app-wide :focus-visible ring. */
          className="w-full px-4 py-2.5 pl-10 pr-14 sm:pr-32 border border-border-strong rounded-lg outline-none transition-all"
        />
        <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-faint"></i>

        {/* Filter Toggle Button - Positioned inside search bar */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{ right: '8px', top: '50%', transform: 'translateY(-50%)' }}
          className={`absolute px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${
            hasActiveFilters
              ? 'bg-brand text-white hover:bg-brand-hover'
              : 'bg-surface-sunken text-secondary hover:bg-gray-200 dark:hover:bg-stone-800'
          }`}
        >
          {/* Icon-only on phones: the full label + pr-32 left ~150px of
              typing space at 360px */}
          <i className="fas fa-filter text-xs"></i>
          <span className="hidden sm:inline">Filters</span>
          {hasActiveFilters && (
            <span className="ml-0.5 bg-white text-violet-600 rounded-full w-5 h-5 inline-flex items-center justify-center text-xs font-semibold">
              {[filters.sport, filters.school, filters.league, filters.dateFrom, filters.place, filters.country, filters.type !== 'all'].filter(Boolean).length}
            </span>
          )}
        </button>

        {loading && (
          <div className="absolute right-14 sm:right-32 top-1/2 transform -translate-y-1/2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-brand"></div>
          </div>
        )}
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="mt-2 w-full bg-surface-raised border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-primary">Advanced Filters</h3>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
              >
                Clear All
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Type Filter */}
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">
                Search Type
              </label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value as SearchFilters['type'] })}
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              >
                <option value="all">All Results</option>
                <option value="athletes">{`Athletes Only${typeCount('athlete')}`}</option>
                <option value="courses">{`Golf Courses Only${typeCount('course')}`}</option>
                <option value="posts">{`Posts Only${typeCount('post')}`}</option>
                <option value="clubs">{`Clubs Only${typeCount('club')}`}</option>
                <option value="leagues">{`Leagues Only${typeCount('league')}`}</option>
              </select>
            </div>

            {/* Sport Filter */}
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">
                Sport
              </label>
              <select
                value={filters.sport || ''}
                onChange={(e) => setFilters({ ...filters, sport: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              >
                <option value="">All Sports</option>
                {Object.values(SPORT_REGISTRY).map((sport) => (
                  <option key={sport.sport_key} value={sport.sport_key}>
                    {sport.display_name}
                  </option>
                ))}
              </select>
            </div>

            {/* School Filter */}
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">
                School
              </label>
              <input
                type="text"
                value={filters.school || ''}
                onChange={(e) => setFilters({ ...filters, school: e.target.value || undefined })}
                placeholder="e.g., Stanford University"
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              />
            </div>

            {/* Location filter (108): athletes and clubs within 50 km of a
                picked place. Pick-only — typed text is not a filter. */}
            <div>
              <label htmlFor="search-filter-place" className="block text-sm font-medium text-secondary mb-1">
                Location
              </label>
              <PlacePicker
                id="search-filter-place"
                value={filters.place ?? null}
                text={placeText}
                allowFreeText={false}
                placeholder="City or town — within 50 km"
                onChange={(place, text) => {
                  setPlaceText(text);
                  setFilters({ ...filters, place: place ?? undefined });
                }}
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              />
            </div>

            {/* Country / Region facets (search_all_facets, 112): options are
                the matched set's own counts; the codes feed the same
                country/region params search_all already filters on. */}
            <div>
              <label htmlFor="search-filter-country" className="block text-sm font-medium text-secondary mb-1">
                Country
              </label>
              <select
                id="search-filter-country"
                value={filters.country || ''}
                onChange={(e) => setFilters({ ...filters, country: e.target.value || undefined, region: undefined })}
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              >
                <option value="">All countries</option>
                {(facets?.countries ?? []).map((c) => (
                  <option key={c.code} value={c.code}>{`${c.label} (${c.n})`}</option>
                ))}
                {filters.country && !facets?.countries.some((c) => c.code === filters.country) && (
                  <option value={filters.country}>{filters.country}</option>
                )}
              </select>
            </div>

            <div>
              <label htmlFor="search-filter-region" className="block text-sm font-medium text-secondary mb-1">
                Region
              </label>
              <select
                id="search-filter-region"
                value={filters.region || ''}
                disabled={!filters.country}
                onChange={(e) => setFilters({ ...filters, region: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:ring-2 focus:ring-violet-500 focus:border-violet-500 disabled:opacity-60"
              >
                <option value="">{filters.country ? 'All regions' : 'Pick a country first'}</option>
                {(facets?.regions ?? []).map((r) => (
                  <option key={r.code} value={r.code}>{`${r.label} (${r.n})`}</option>
                ))}
                {filters.region && !facets?.regions.some((r) => r.code === filters.region) && (
                  <option value={filters.region}>{filters.region}</option>
                )}
              </select>
            </div>

            {/* League Filter */}
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">
                League/Conference
              </label>
              <input
                type="text"
                value={filters.league || ''}
                onChange={(e) => setFilters({ ...filters, league: e.target.value || undefined })}
                placeholder="e.g., NCAA D1, Big Ten"
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              />
            </div>

            {/* Date From */}
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">
                Date From
              </label>
              <input
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-sm font-medium text-secondary mb-1">
                Date To
              </label>
              <input
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-border-strong rounded-md focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Results — INLINE flow content, not an absolutely-positioned dropdown.
          The dialog wraps this component in `min-h-0 flex-1 overflow-y-auto`
          (HeaderSearch.tsx), and that wrapper is only as tall as the input, so
          a floating `absolute top-full` list rendered entirely BELOW it: 46px
          container, list at y=126-294, clipped away with the modal backdrop
          painting where the results should be. Measured, not guessed.
          Inline, the dialog grows to fit and its own scroller does the work
          its comment says it was added for. */}
      {hasQuery && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          className="mt-2 w-full bg-surface-raised border border-border rounded-lg overflow-hidden"
        >
          {failed ? (
            /* A failed request must not read as "nothing matched" — that
               confusion is what let the original search bug survive. */
            <div className="p-4 text-center text-muted">
              <i className="fas fa-triangle-exclamation text-2xl mb-2"></i>
              <p>Search is unavailable right now. Try again in a moment.</p>
            </div>
          ) : items.length === 0 && clubs.length === 0 ? (
            loading ? (
              <div className="p-4 text-center text-muted">
                <i className="fas fa-circle-notch fa-spin text-2xl mb-2"></i>
                <p>Searching…</p>
              </div>
            ) : (
              <div className="p-4 text-center text-muted">
                <i className="fas fa-search text-2xl mb-2"></i>
                <p>No results found</p>
              </div>
            )
          ) : (
            <>
              {/* Athletes Section */}
              {athletes.length > 0 && (
                <div className="border-b border-border-subtle">
                  <div className="px-4 py-2 bg-surface-muted border-b border-border-subtle">
                    <h3 className="text-sm font-semibold text-secondary">Athletes</h3>
                  </div>
                  {athletes.map((athlete: SearchAthleteResult, i: number) => (
                    <div
                      key={athlete.id}
                      id={optionId(i)}
                      role="option"
                      aria-selected={activeIndex === i}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => activate({ kind: 'athlete', id: athlete.id, athlete })}
                      className={`px-4 py-3 cursor-pointer transition-colors flex items-center gap-3 ${
                        activeIndex === i ? 'bg-surface-muted' : 'hover:bg-surface-muted'
                      }`}
                    >
                      {athlete.avatar_url ? (
                        <Image
                          src={athlete.avatar_url}
                          alt={formatDisplayName(athlete.first_name, null, athlete.last_name, athlete.full_name) || 'Athlete'}
                          width={40}
                          height={40}
                          className="rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm font-semibold">
                            {getInitials(formatDisplayName(athlete.first_name, null, athlete.last_name, athlete.full_name))}
                          </span>
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="font-medium text-primary">
                          {formatDisplayName(athlete.first_name, null, athlete.last_name, athlete.full_name)}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-muted">
                          {athlete.sport && (
                            <span className="capitalize">{athlete.sport}</span>
                          )}
                          {athlete.school && (
                            <>
                              {athlete.sport && <span>•</span>}
                              <span>{athlete.school}</span>
                            </>
                          )}
                          {/* Location was fetched and never shown (audit,
                              Aug 24). Structured place first, else the
                              free text; distance when the search was "near". */}
                          {(athlete.city || athlete.location) && (
                            <>
                              {(athlete.sport || athlete.school) && <span>•</span>}
                              <span className="truncate">
                                {formatPlace({ city: athlete.city, region: athlete.region, country: athlete.country }) ||
                                  athlete.location}
                                {typeof athlete.distance_km === 'number' && ` · ${Math.round(athlete.distance_km)} km`}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      {athlete.visibility === 'private' && (
                        <i className="fas fa-lock text-faint text-sm"></i>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Posts Section */}
              {/* Courses (104): the catalog through the same box. */}
              {courses.length > 0 && (
                <div className="border-b border-border-subtle">
                  <div className="px-4 py-2 bg-surface-muted border-b border-border-subtle">
                    <h3 className="text-sm font-semibold text-secondary">Golf Courses</h3>
                  </div>
                  {courses.map((course: GolfCourse, i: number) => {
                    const navIndex = athletes.length + i;
                    return (
                      <div
                        key={course.id}
                        id={optionId(navIndex)}
                        role="option"
                        aria-selected={activeIndex === navIndex}
                        onMouseEnter={() => setActiveIndex(navIndex)}
                        onClick={() => activate({ kind: 'course', id: course.id, course })}
                        className={`px-4 py-3 cursor-pointer ${activeIndex === navIndex ? 'bg-brand/10' : 'hover:bg-surface-muted'}`}
                      >
                        <p className="font-medium text-primary">{course.name}</p>
                        <p className="text-sm text-muted line-clamp-1">
                          {formatPlace({ city: course.city, region: course.state, country: course.country })}
                          {typeof course.distanceKm === 'number' && ` · ${Math.round(course.distanceKm)} km`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {posts.length > 0 && (
                <div className="border-b border-border-subtle">
                  <div className="px-4 py-2 bg-surface-muted border-b border-border-subtle">
                    <h3 className="text-sm font-semibold text-secondary">Posts</h3>
                  </div>
                  {posts.map((post: SearchPostResult, i: number) => {
                    // Posts follow athletes and courses in the flat nav list.
                    const navIndex = athletes.length + courses.length + i;
                    return (
                    <div
                      key={post.id}
                      id={optionId(navIndex)}
                      role="option"
                      aria-selected={activeIndex === navIndex}
                      onMouseEnter={() => setActiveIndex(navIndex)}
                      onClick={() => activate({ kind: 'post', id: post.id, post })}
                      className={`px-4 py-3 cursor-pointer transition-colors flex items-center gap-3 ${
                        activeIndex === navIndex ? 'bg-surface-muted' : 'hover:bg-surface-muted'
                      }`}
                    >
                      {post.post_media?.[0] && (
                        <Image
                          src={post.post_media[0].media_url}
                          alt="Post preview"
                          width={48}
                          height={48}
                          className="rounded object-cover"
                        />
                      )}
                      <div className="flex-1">
                        <p className="text-sm text-primary line-clamp-2">
                          {post.caption || 'Post without caption'}
                        </p>
                        <p className="text-xs text-muted mt-1">
                          by {formatDisplayName(post.profile?.first_name, null, post.profile?.last_name, post.profile?.full_name)}
                        </p>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}

              {/* Leagues (113): navigable — /league/[id] ships with them. */}
              {leagues.length > 0 && (
                <div className="border-b border-border-subtle">
                  <div className="px-4 py-2 bg-surface-muted border-b border-border-subtle">
                    <h3 className="text-sm font-semibold text-secondary">Leagues</h3>
                  </div>
                  {leagues.map((league: SearchLeagueResult, i: number) => {
                    // Leagues follow athletes, courses and posts in the flat nav list.
                    const navIndex = athletes.length + courses.length + posts.length + i;
                    return (
                      <div
                        key={league.id}
                        id={optionId(navIndex)}
                        role="option"
                        aria-selected={activeIndex === navIndex}
                        onMouseEnter={() => setActiveIndex(navIndex)}
                        onClick={() => activate({ kind: 'league', id: league.id, league })}
                        className={`px-4 py-3 cursor-pointer ${activeIndex === navIndex ? 'bg-brand/10' : 'hover:bg-surface-muted'}`}
                      >
                        <p className="font-medium text-primary">{league.name}</p>
                        <p className="text-sm text-muted line-clamp-1">
                          {league.sport_key
                            ? (SPORT_REGISTRY[league.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? league.sport_key)
                            : null}
                          {league.sport_key && (league.city || league.country) ? ' · ' : ''}
                          {formatPlace({ city: league.city, region: league.region, country: league.country })}
                          {typeof league.distance_km === 'number' && ` · ${Math.round(league.distance_km)} km`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Clubs Section */}
              {clubs.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-surface-muted border-b border-border-subtle">
                    <h3 className="text-sm font-semibold text-secondary">Clubs</h3>
                  </div>
                  {/* Club rows are NOT clickable: they used to push to
                      /club/[id], a route that does not exist, so every club
                      result was a 404 — a dead end, which this app's navigation
                      rules forbid. Restore the handler when the route ships. */}
                  {clubs.map((club: SearchClubResult) => (
                    <div
                      key={club.id}
                      className="px-4 py-3"
                    >
                      <p className="font-medium text-primary">{club.name}</p>
                      <p className="text-sm text-muted line-clamp-1">
                        {formatPlace({ city: club.city, region: club.region, country: club.country }) || club.location}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
