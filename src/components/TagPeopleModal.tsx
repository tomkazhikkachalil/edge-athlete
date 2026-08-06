'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useToast } from './Toast';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

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

  // Declared above the effect that references it: react-hooks/immutability
  // requires declaration before access in source order.
  async function searchProfiles() {
    try {
      setLoading(true);
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&type=athletes`);

      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      const profiles = data.results?.athletes || data.athletes || [];

      const filtered = profiles.filter(
        (profile: Profile) => !existingTags.includes(profile.id)
      );

      setSearchResults(filtered);
    } catch (e) {
      console.error('Failed to search profiles for tagging:', e);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  }

  // Clearing results for a short query is synchronisation (render phase); the
  // debounced search stays an effect.
  const [syncedSearchQuery, setSyncedSearchQuery] = useState(searchQuery);
  if (syncedSearchQuery !== searchQuery) {
    setSyncedSearchQuery(searchQuery);
    if (searchQuery.length < 2) setSearchResults([]);
  }

  useEffect(() => {
    if (searchQuery.length >= 2) {
      const timer = setTimeout(() => {
        searchProfiles();
      }, 300); // Debounce search
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);


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
    } catch (e) {
      console.error('Failed to add post tags:', e);
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

  // Lock background scroll while open (iOS scroll-chaining behind overlays)
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      {/* max-h-modal + flex-col: the old 80vh + overflow-hidden panel with a
          fixed 300px list CLIPPED the bottom of the results on short phones —
          header + search + a grown selected-chips block + 300px exceeded 80vh
          on an iPhone SE, and overflow-hidden ate the remainder. Now the list
          is the only scroll area and takes whatever height is left. */}
      <div className="bg-surface-raised rounded-lg max-w-md w-full max-h-modal overflow-hidden shadow-xl flex flex-col">
        {/* Header */}
        <div className="shrink-0 p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-bold text-primary">Tag People</h2>
          <button
            onClick={onClose}
            className="ea-icon-btn inline-flex items-center justify-center text-faint hover:text-tertiary"
            aria-label="Close"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 p-4 border-b border-border">
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search people..."
              className="w-full px-4 py-2 pl-10 border border-border-strong rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <i className="fas fa-search absolute left-3 top-3 text-faint"></i>
          </div>
        </div>

        {/* Selected People. Capped: with many selections this block would
            otherwise grow unbounded and starve the results list below. */}
        {selectedProfiles.length > 0 && (
          <div className="shrink-0 max-h-32 overflow-y-auto overscroll-contain p-4 border-b border-border bg-brand-soft">
            <p className="text-sm font-semibold text-secondary mb-2">
              Selected ({selectedProfiles.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedProfiles.map(profile => (
                <div
                  key={profile.id}
                  className="flex items-center gap-2 bg-surface px-3 py-1 rounded-full border border-violet-300 dark:border-violet-700"
                >
                  <span className="text-sm font-medium text-primary">
                    {getDisplayName(profile)}
                  </span>
                  <button
                    onClick={() => toggleProfile(profile)}
                    className="text-faint hover:text-red-600 dark:hover:text-red-400"
                  >
                    <i className="fas fa-times text-xs"></i>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search Results — the panel's only scroll area */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && (
            <div className="p-8 text-center">
              <i className="fas fa-spinner fa-spin text-2xl text-faint"></i>
            </div>
          )}

          {!loading && searchQuery.length < 2 && (
            <div className="p-8 text-center">
              <i className="fas fa-search text-3xl text-gray-300 dark:text-stone-600 mb-2"></i>
              <p className="text-tertiary text-sm">Type to search for people</p>
            </div>
          )}

          {!loading && searchQuery.length >= 2 && searchResults.length === 0 && (
            <div className="p-8 text-center">
              <i className="fas fa-user-slash text-3xl text-gray-300 dark:text-stone-600 mb-2"></i>
              <p className="text-secondary font-medium mb-1">No people found</p>
              <p className="text-muted text-xs">
                Try searching by name, sport, or school
              </p>
            </div>
          )}

          {!loading && searchResults.length > 0 && (
            <div className="divide-y divide-border">
              {searchResults.map(profile => {
                const isSelected = selectedProfiles.some(p => p.id === profile.id);

                return (
                  <button
                    key={profile.id}
                    onClick={() => toggleProfile(profile)}
                    className="w-full p-4 flex items-center gap-3 hover:bg-surface-muted transition-colors text-left"
                  >
                    {profile.avatar_url ? (
                      <Image
                        src={profile.avatar_url}
                        alt={getDisplayName(profile)}
                        width={48}
                        height={48}
                        className="rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-gray-200 dark:bg-stone-800 flex items-center justify-center">
                        <span className="text-tertiary font-semibold">
                          {getDisplayName(profile).charAt(0)}
                        </span>
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-primary">
                        {getDisplayName(profile)}
                      </p>
                      {profile.sport && profile.school && (
                        <p className="text-sm text-tertiary">
                          {profile.sport} • {profile.school}
                        </p>
                      )}
                    </div>

                    {isSelected && (
                      <i className="fas fa-check-circle text-brand-fg text-xl"></i>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-secondary hover:text-primary font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={selectedProfiles.length === 0 || submitting}
            className="px-6 py-2 bg-brand text-white font-semibold rounded-lg hover:bg-brand-hover disabled:bg-gray-300 dark:disabled:bg-stone-700 disabled:cursor-not-allowed transition-colors"
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
