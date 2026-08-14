'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { SearchAthleteResult, SearchPostResult, SearchClubResult } from '@/types/search';
import { useTypeahead } from '@/hooks/useTypeahead';

// One flat, ordered list of the ACTIVATABLE results, so arrow-key navigation
// has a single index to walk. Clubs are deliberately not in here: their rows
// are inert (the /club/[id] route does not exist), and letting the keyboard
// land on a row that does nothing is worse than not reaching it at all.
type NavItem =
  | { kind: 'athlete'; id: string; athlete: SearchAthleteResult }
  | { kind: 'post'; id: string; post: SearchPostResult };

interface SearchFilters {
  sport?: string;
  school?: string;
  league?: string;
  dateFrom?: string;
  dateTo?: string;
  type: 'all' | 'athletes' | 'posts' | 'clubs';
}

export default function AdvancedSearchBar() {
  const router = useRouter();
  const { user } = useAuth();
  const [showResults, setShowResults] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  // Clubs live outside the typeahead's item list because they are not
  // keyboard-activatable (see NavItem). Same request, separate bucket.
  const [clubs, setClubs] = useState<SearchClubResult[]>([]);

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

    const response = await fetch(`/api/search?${params}`, { signal });
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    const data = await response.json();

    setClubs((data.results?.clubs ?? []) as SearchClubResult[]);

    const athletes = (data.results?.athletes ?? []) as SearchAthleteResult[];
    const posts = (data.results?.posts ?? []) as SearchPostResult[];
    return [
      ...athletes.map((a): NavItem => ({ kind: 'athlete', id: a.id, athlete: a })),
      ...posts.map((p): NavItem => ({ kind: 'post', id: p.id, post: p })),
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
    loading,
    failed,
    activeIndex,
    setActiveIndex,
    onKeyDown: onListKeyDown,
    reset: resetSearch,
  } = useTypeahead<NavItem>({
    scope: `search:all:${filterKey}`,
    fetcher,
    limit: 35,
  });

  const athletes = useMemo(
    () => items.flatMap(i => (i.kind === 'athlete' ? [i.athlete] : [])),
    [items]
  );
  const posts = useMemo(
    () => items.flatMap(i => (i.kind === 'post' ? [i.post] : [])),
    [items]
  );

  // Opening on results is synchronisation, not an effect.
  const hasAnything = items.length > 0 || clubs.length > 0;
  const [syncedHasAnything, setSyncedHasAnything] = useState(hasAnything);
  if (syncedHasAnything !== hasAnything) {
    setSyncedHasAnything(hasAnything);
    if (hasAnything) setShowResults(true);
  }

  const activate = useCallback((item: NavItem) => {
    if (item.kind === 'athlete') {
      router.push(user?.id === item.athlete.id ? '/athlete' : `/athlete/${item.athlete.id}`);
    } else {
      router.push(`/feed?post=${item.post.id}`);
    }
    setShowResults(false);
    resetSearch();
  }, [router, user?.id, resetSearch]);

  // Arrow keys move, Enter opens, Escape closes the dropdown before the
  // surrounding panel gets the event. Without this the ⌘K shortcut opened a
  // result list a keyboard user could not reach at all — the rows were plain
  // unfocusable divs.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (onListKeyDown(e)) return;
    if (e.key === 'Enter' && showResults && items[activeIndex]) {
      e.preventDefault();
      activate(items[activeIndex]);
      return;
    }
    if (e.key === 'Escape' && showResults) {
      e.preventDefault();
      e.stopPropagation();
      setShowResults(false);
    }
  };

  const listboxId = 'ea-search-results';
  const optionId = (i: number) => `${listboxId}-option-${i}`;

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
        setShowFilters(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);


  const clearFilters = () => {
    setFilters({ type: 'all' });
  };

  const hasActiveFilters = filters.sport || filters.school || filters.league || filters.dateFrom || filters.dateTo || filters.type !== 'all';

  return (
    <div ref={searchRef} className="relative w-full">
      {/* Search Input */}
      <div className="relative flex items-center">
        <input
          type="text"
          name="ea-search"
          autoComplete="off"
          role="combobox"
          aria-expanded={showResults && items.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            showResults && items[activeIndex] ? optionId(activeIndex) : undefined
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search athletes, posts, clubs..."
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
              {[filters.sport, filters.school, filters.league, filters.dateFrom, filters.type !== 'all'].filter(Boolean).length}
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
        <div className="absolute top-full mt-2 w-full bg-surface-raised border border-border rounded-lg shadow-lg p-4 z-50">
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
                <option value="athletes">Athletes Only</option>
                <option value="posts">Posts Only</option>
                <option value="clubs">Clubs Only</option>
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

      {/* Search Results Dropdown */}
      {showResults && query.trim().length >= 1 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search results"
          className="absolute top-full mt-2 w-full bg-surface-raised border border-border rounded-lg shadow-lg max-h-96 overflow-y-auto z-40"
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
              {posts.length > 0 && (
                <div className="border-b border-border-subtle">
                  <div className="px-4 py-2 bg-surface-muted border-b border-border-subtle">
                    <h3 className="text-sm font-semibold text-secondary">Posts</h3>
                  </div>
                  {posts.map((post: SearchPostResult, i: number) => {
                    // Posts follow athletes in the flat nav list.
                    const navIndex = athletes.length + i;
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
                        {club.location}
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
