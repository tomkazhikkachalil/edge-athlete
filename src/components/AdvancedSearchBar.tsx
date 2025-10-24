'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { SearchResults, SearchAthleteResult, SearchPostResult, SearchClubResult } from '@/types/search';

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
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults>({ athletes: [], posts: [], clubs: [] });
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Filter state
  const [filters, setFilters] = useState<SearchFilters>({
    type: 'all'
  });

  // Debounced search
  useEffect(() => {
    if (query.length < 2) {
      setResults({ athletes: [], posts: [], clubs: [] });
      setShowResults(false);
      return;
    }

    const timer = setTimeout(() => {
      performSearch();
    }, 300);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters]);

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

  const performSearch = async () => {
    setLoading(true);
    try {
      // Build query params
      const params = new URLSearchParams({ q: query });
      if (filters.type !== 'all') params.append('type', filters.type);
      if (filters.sport) params.append('sport', filters.sport);
      if (filters.school) params.append('school', filters.school);
      if (filters.league) params.append('league', filters.league);
      if (filters.dateFrom) params.append('dateFrom', filters.dateFrom);
      if (filters.dateTo) params.append('dateTo', filters.dateTo);

      const response = await fetch(`/api/search?${params}`);
      const data = await response.json();

      // API returns { query, results, total }, we need the results object
      setResults(data.results || { athletes: [], posts: [], clubs: [] });
      setShowResults(true);
    } catch {
    } finally {
      setLoading(false);
    }
  };

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
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search athletes, posts, clubs..."
          className="w-full px-4 py-2.5 pl-10 pr-32 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
        />
        <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>

        {/* Filter Toggle Button - Positioned inside search bar */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          style={{ right: '8px', top: '50%', transform: 'translateY(-50%)' }}
          className={`absolute px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 ${
            hasActiveFilters
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <i className="fas fa-filter text-xs"></i>
          <span>Filters</span>
          {hasActiveFilters && (
            <span className="ml-0.5 bg-white text-blue-600 rounded-full w-5 h-5 inline-flex items-center justify-center text-xs font-semibold">
              {[filters.sport, filters.school, filters.league, filters.dateFrom, filters.type !== 'all'].filter(Boolean).length}
            </span>
          )}
        </button>

        {loading && (
          <div className="absolute right-32 top-1/2 transform -translate-y-1/2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
          </div>
        )}
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="absolute top-full mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-lg p-4 z-50">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">Advanced Filters</h3>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Clear All
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Search Type
              </label>
              <select
                value={filters.type}
                onChange={(e) => setFilters({ ...filters, type: e.target.value as SearchFilters['type'] })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Results</option>
                <option value="athletes">Athletes Only</option>
                <option value="posts">Posts Only</option>
                <option value="clubs">Clubs Only</option>
              </select>
            </div>

            {/* Sport Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sport
              </label>
              <select
                value={filters.sport || ''}
                onChange={(e) => setFilters({ ...filters, sport: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">
                School
              </label>
              <input
                type="text"
                value={filters.school || ''}
                onChange={(e) => setFilters({ ...filters, school: e.target.value || undefined })}
                placeholder="e.g., Stanford University"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* League Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                League/Conference
              </label>
              <input
                type="text"
                value={filters.league || ''}
                onChange={(e) => setFilters({ ...filters, league: e.target.value || undefined })}
                placeholder="e.g., NCAA D1, Big Ten"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Date From */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date From
              </label>
              <input
                type="date"
                value={filters.dateFrom || ''}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date To
              </label>
              <input
                type="date"
                value={filters.dateTo || ''}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Search Results Dropdown */}
      {showResults && query.length >= 2 && (
        <div className="absolute top-full mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto z-40">
          {results.athletes.length === 0 && results.posts.length === 0 && results.clubs.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              <i className="fas fa-search text-2xl mb-2"></i>
              <p>No results found</p>
            </div>
          ) : (
            <>
              {/* Athletes Section */}
              {results.athletes.length > 0 && (
                <div className="border-b border-gray-100">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-700">Athletes</h3>
                  </div>
                  {results.athletes.map((athlete: SearchAthleteResult) => (
                    <div
                      key={athlete.id}
                      onClick={() => {
                        // Navigate to own profile if clicking own profile
                        if (user?.id === athlete.id) {
                          router.push('/athlete');
                        } else {
                          router.push(`/athlete/${athlete.id}`);
                        }
                        setShowResults(false);
                        setQuery('');
                      }}
                      className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors flex items-center gap-3"
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
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                          <span className="text-white text-sm font-semibold">
                            {getInitials(formatDisplayName(athlete.first_name, null, athlete.last_name, athlete.full_name))}
                          </span>
                        </div>
                      )}
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">
                          {formatDisplayName(athlete.first_name, null, athlete.last_name, athlete.full_name)}
                        </p>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
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
                        <i className="fas fa-lock text-gray-400 text-sm"></i>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Posts Section */}
              {results.posts.length > 0 && (
                <div className="border-b border-gray-100">
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-700">Posts</h3>
                  </div>
                  {results.posts.map((post: SearchPostResult) => (
                    <div
                      key={post.id}
                      onClick={() => {
                        router.push(`/feed?post=${post.id}`);
                        setShowResults(false);
                        setQuery('');
                      }}
                      className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors flex items-center gap-3"
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
                        <p className="text-sm text-gray-900 line-clamp-2">
                          {post.caption || 'Post without caption'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          by {formatDisplayName(post.profile?.first_name, null, post.profile?.last_name, post.profile?.full_name)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Clubs Section */}
              {results.clubs.length > 0 && (
                <div>
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                    <h3 className="text-sm font-semibold text-gray-700">Clubs</h3>
                  </div>
                  {results.clubs.map((club: SearchClubResult) => (
                    <div
                      key={club.id}
                      onClick={() => {
                        router.push(`/club/${club.id}`);
                        setShowResults(false);
                        setQuery('');
                      }}
                      className="px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    >
                      <p className="font-medium text-gray-900">{club.name}</p>
                      <p className="text-sm text-gray-500 line-clamp-1">
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
