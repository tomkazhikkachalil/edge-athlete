'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { getSportIcon, getSportName } from '@/lib/config/sports-config';

interface SearchResult {
  athletes: any[];
  posts: any[];
  clubs: any[];
}

export default function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult>({ athletes: [], posts: [], clubs: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    const delaySearch = setTimeout(() => {
      if (query.trim().length >= 2) {
        performSearch();
      } else {
        setResults({ athletes: [], posts: [], clubs: [] });
        setShowResults(false);
      }
    }, 300);

    return () => clearTimeout(delaySearch);
  }, [query]);

  const performSearch = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();

      if (response.ok) {
        setResults(data.results);
        setShowResults(true);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAthleteClick = (athleteId: string) => {
    router.push(`/athlete/${athleteId}`);
    setShowResults(false);
    setQuery('');
  };

  const handlePostClick = (postId: string) => {
    // Could navigate to a post detail page or open modal
    router.push(`/feed?post=${postId}`);
    setShowResults(false);
    setQuery('');
  };

  const totalResults = results.athletes.length + results.posts.length + results.clubs.length;

  return (
    <div ref={searchRef} className="relative w-full">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && setShowResults(true)}
          placeholder="Search athletes, posts, teams..."
          className="w-full pl-10 pr-4 py-2 bg-gray-100 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
        <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
        {isLoading && (
          <i className="fas fa-spinner fa-spin absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && totalResults > 0 && (
        <div className="absolute top-full mt-2 w-full bg-white rounded-lg shadow-lg border border-gray-200 max-h-96 overflow-y-auto z-50">
          {/* Athletes */}
          {results.athletes.length > 0 && (
            <div className="p-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase px-3 py-2">Athletes</h3>
              {results.athletes.map((athlete) => (
                <button
                  key={athlete.id}
                  onClick={() => handleAthleteClick(athlete.id)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
                >
                  {athlete.avatar_url ? (
                    <img
                      src={athlete.avatar_url}
                      alt={athlete.full_name}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                      <span className="text-white text-sm font-semibold">
                        {getInitials(formatDisplayName(athlete.full_name, athlete.first_name, athlete.last_name))}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">
                      {formatDisplayName(athlete.full_name, athlete.first_name, athlete.last_name)}
                    </div>
                    <div className="text-sm text-gray-500 truncate">
                      {[athlete.sport, athlete.position, athlete.school].filter(Boolean).join(' • ')}
                    </div>
                  </div>
                  <i className="fas fa-arrow-right text-gray-400 text-sm"></i>
                </button>
              ))}
            </div>
          )}

          {/* Posts */}
          {results.posts.length > 0 && (
            <div className="p-2 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase px-3 py-2">Posts</h3>
              {results.posts.map((post) => {
                const SportIcon = post.sport_key ? getSportIcon(post.sport_key) : null;
                return (
                  <button
                    key={post.id}
                    onClick={() => handlePostClick(post.id)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
                  >
                    {post.post_media?.[0] ? (
                      <img
                        src={post.post_media[0].media_url}
                        alt="Post"
                        className="w-10 h-10 rounded object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center">
                        <i className="fas fa-image text-gray-400"></i>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 text-sm">
                          {formatDisplayName(
                            post.profiles?.full_name,
                            post.profiles?.first_name,
                            post.profiles?.last_name
                          )}
                        </span>
                        {SportIcon && (
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <SportIcon size={12} />
                            {getSportName(post.sport_key)}
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-600 truncate">
                        {post.caption || 'No caption'}
                      </div>
                    </div>
                    <i className="fas fa-arrow-right text-gray-400 text-sm"></i>
                  </button>
                );
              })}
            </div>
          )}

          {/* Clubs */}
          {results.clubs.length > 0 && (
            <div className="p-2 border-t border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase px-3 py-2">Clubs & Teams</h3>
              {results.clubs.map((club) => (
                <button
                  key={club.id}
                  onClick={() => {
                    // Navigate to club page when implemented
                    setShowResults(false);
                    setQuery('');
                  }}
                  className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 rounded-lg transition-colors text-left"
                >
                  {club.logo_url ? (
                    <img
                      src={club.logo_url}
                      alt={club.name}
                      className="w-10 h-10 rounded object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 bg-gray-200 rounded flex items-center justify-center">
                      <i className="fas fa-users text-gray-400"></i>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 truncate">{club.name}</div>
                    <div className="text-sm text-gray-500 truncate">
                      {club.location || 'No location'}
                    </div>
                  </div>
                  <i className="fas fa-arrow-right text-gray-400 text-sm"></i>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* No Results */}
      {showResults && query.length >= 2 && totalResults === 0 && !isLoading && (
        <div className="absolute top-full mt-2 w-full bg-white rounded-lg shadow-lg border border-gray-200 p-6 text-center z-50">
          <i className="fas fa-search text-3xl text-gray-300 mb-2"></i>
          <p className="text-gray-600">No results found for "{query}"</p>
          <p className="text-sm text-gray-500 mt-1">Try different keywords</p>
        </div>
      )}
    </div>
  );
}
