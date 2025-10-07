'use client';

import { useState, useEffect } from 'react';
import { useToast } from './Toast';

interface Profile {
  id: string;
  full_name?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  avatar_url?: string;
  sport?: string;
  school?: string;
}

interface TagPeopleModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId?: string; // Optional for new posts (selection mode)
  existingTags?: string[]; // Array of already-tagged profile IDs
  onTagsAdded?: () => void;
  onSelectionComplete?: (selectedIds: string[], selectedProfiles?: Profile[]) => void; // For selection mode (new posts)
  selectionMode?: boolean; // If true, just returns selected IDs instead of creating tags
}

export default function TagPeopleModal({
  isOpen,
  onClose,
  postId,
  existingTags = [],
  onTagsAdded,
  onSelectionComplete,
  selectionMode = false
}: TagPeopleModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [selectedProfiles, setSelectedProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const { showSuccess, showError } = useToast();

  useEffect(() => {
    if (searchQuery.length >= 2) {
      const timer = setTimeout(() => {
        searchProfiles();
      }, 300); // Debounce search
      return () => clearTimeout(timer);
    } else {
      setSearchResults([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const searchProfiles = async () => {
    try {
      setLoading(true);
      console.log('[TagPeopleModal] Searching for:', searchQuery);
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&type=athletes`);

      if (!response.ok) {
        console.error('[TagPeopleModal] Search request failed:', response.status);
        throw new Error('Search failed');
      }

      const data = await response.json();
      console.log('[TagPeopleModal] Search response:', data);
      console.log('[TagPeopleModal] Athletes array:', data.athletes);
      console.log('[TagPeopleModal] Results object:', data.results);
      const profiles = data.results?.athletes || data.athletes || [];
      console.log('[TagPeopleModal] Found profiles:', profiles.length);

      // Filter out already tagged profiles
      const filtered = profiles.filter(
        (profile: Profile) => !existingTags.includes(profile.id)
      );
      console.log('[TagPeopleModal] Filtered profiles:', filtered.length);

      setSearchResults(filtered);
    } catch (error) {
      console.error('[TagPeopleModal] Error searching profiles:', error);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const toggleProfile = (profile: Profile) => {
    const isSelected = selectedProfiles.some(p => p.id === profile.id);

    if (isSelected) {
      setSelectedProfiles(selectedProfiles.filter(p => p.id !== profile.id));
    } else {
      setSelectedProfiles([...selectedProfiles, profile]);
    }
  };

  const handleSubmit = async () => {
    if (selectedProfiles.length === 0) {
      showError('Please select at least one person to tag');
      return;
    }

    // Selection mode: just return selected IDs and profile data
    if (selectionMode) {
      if (onSelectionComplete) {
        onSelectionComplete(selectedProfiles.map(p => p.id), selectedProfiles);
      }
      setSelectedProfiles([]);
      setSearchQuery('');
      setSearchResults([]);
      onClose();
      return;
    }

    // Tag creation mode: create tags via API
    try {
      setSubmitting(true);

      const tags = selectedProfiles.map(profile => ({
        taggedProfileId: profile.id
      }));

      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, tags })
      });

      if (!response.ok) {
        throw new Error('Failed to add tags');
      }

      showSuccess(`Tagged ${selectedProfiles.length} ${selectedProfiles.length === 1 ? 'person' : 'people'}`);

      if (onTagsAdded) {
        onTagsAdded();
      }

      onClose();
    } catch (error) {
      console.error('Error adding tags:', error);
      showError('Failed to add tags');
    } finally {
      setSubmitting(false);
    }
  };

  const getDisplayName = (profile: Profile) => {
    if (profile.first_name && profile.last_name) {
      return `${profile.first_name} ${profile.last_name}`;
    }
    return profile.full_name || 'Unknown User';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[80vh] overflow-hidden shadow-xl">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Tag People</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search people..."
              className="w-full px-4 py-2 pl-10 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <i className="fas fa-search absolute left-3 top-3 text-gray-400"></i>
          </div>
        </div>

        {/* Selected People */}
        {selectedProfiles.length > 0 && (
          <div className="p-4 border-b border-gray-200 bg-blue-50">
            <p className="text-sm font-semibold text-gray-700 mb-2">
              Selected ({selectedProfiles.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedProfiles.map(profile => (
                <div
                  key={profile.id}
                  className="flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-blue-300"
                >
                  <span className="text-sm font-medium text-gray-900">
                    {getDisplayName(profile)}
                  </span>
                  <button
                    onClick={() => toggleProfile(profile)}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <i className="fas fa-times text-xs"></i>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search Results */}
        <div className="overflow-y-auto" style={{ maxHeight: '300px' }}>
          {loading && (
            <div className="p-8 text-center">
              <i className="fas fa-spinner fa-spin text-2xl text-gray-400"></i>
            </div>
          )}

          {!loading && searchQuery.length < 2 && (
            <div className="p-8 text-center">
              <i className="fas fa-search text-3xl text-gray-300 mb-2"></i>
              <p className="text-gray-600 text-sm">Type to search for people</p>
            </div>
          )}

          {!loading && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="p-8 text-center">
              <i className="fas fa-user-slash text-3xl text-gray-300 mb-2"></i>
              <p className="text-gray-700 font-medium mb-1">No people found</p>
              <p className="text-gray-500 text-xs">
                Try searching by name, sport, or school
              </p>
            </div>
          )}

          {!loading && searchResults.length > 0 && (
            <div className="divide-y divide-gray-200">
              {searchResults.map(profile => {
                const isSelected = selectedProfiles.some(p => p.id === profile.id);

                return (
                  <button
                    key={profile.id}
                    onClick={() => toggleProfile(profile)}
                    className="w-full p-4 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
                  >
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt={getDisplayName(profile)}
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center">
                        <span className="text-gray-600 font-semibold">
                          {getDisplayName(profile).charAt(0)}
                        </span>
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900">
                        {getDisplayName(profile)}
                      </p>
                      {profile.sport && profile.school && (
                        <p className="text-sm text-gray-600">
                          {profile.sport} • {profile.school}
                        </p>
                      )}
                    </div>

                    {isSelected && (
                      <i className="fas fa-check-circle text-blue-600 text-xl"></i>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={selectedProfiles.length === 0 || submitting}
            className="px-6 py-2 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? (
              <>
                <i className="fas fa-spinner fa-spin mr-2"></i>
                Tagging...
              </>
            ) : (
              `Tag ${selectedProfiles.length > 0 ? `(${selectedProfiles.length})` : ''}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
