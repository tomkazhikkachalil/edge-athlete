'use client';

import { useState, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useToast } from './Toast';
import { AvatarImage } from '@/components/OptimizedImage';
import { getInitials } from '@/lib/formatters';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useTypeahead } from '@/hooks/useTypeahead';
import { rankPeople, type PersonSuggestion } from '@/lib/search/people';
import FaIcon from '@/components/FaIcon';
import { faCheck } from '@/lib/icons/fa/check';
import { faCircleCheck } from '@/lib/icons/fa/circle-check';
import { faMagnifyingGlass } from '@/lib/icons/fa/magnifying-glass';
import { faSpinner } from '@/lib/icons/fa/spinner';
import { faUserSlash } from '@/lib/icons/fa/user-slash';
import { faXmark } from '@/lib/icons/fa/xmark';

// Nullable, not optional: /api/search has always returned explicit nulls for
// unset name fields. The old `?: string` shape only compiled because the
// results were typed `any` on the way in.
interface Profile {
  id: string;
  full_name?: string | null;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  avatar_url?: string | null;
  sport?: string | null;
  school?: string | null;
}

interface TagPeopleModalProps {
  isOpen: boolean;
  onClose: () => void;
  postId?: string; // Optional for new posts (selection mode)
  existingTags?: string[]; // Array of already-tagged profile IDs
  onTagsAdded?: () => void;
  onSelectionComplete?: (selectedIds: string[], selectedProfiles?: Profile[]) => void; // For selection mode (new posts)
  selectionMode?: boolean; // If true, just returns selected IDs instead of creating tags
  /** The dialog's look. 'mech' is the mechanical dialect (golf part 2, Nov 24
   *  2026): the SAME search, selection and submit drawn as a recessed search
   *  slot, selected chips, a check per result row and a "Tag (n)" key. A
   *  caller opts in as its own screen takes the dialect; the default look is
   *  unchanged for everyone else. */
  variant?: 'default' | 'mech';
}

export default function TagPeopleModal({
  isOpen,
  onClose,
  postId,
  existingTags = [],
  onTagsAdded,
  onSelectionComplete,
  selectionMode = false,
  variant = 'default',
}: TagPeopleModalProps) {
  const [selectedProfiles, setSelectedProfiles] = useState<Profile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { showError } = useToast();

  const fetcher = useCallback(async (q: string, signal: AbortSignal) => {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(q)}&type=athletes`,
      { signal }
    );
    if (!response.ok) throw new Error(`Search failed: ${response.status}`);
    const data = await response.json();
    return (data.results?.athletes ?? []) as PersonSuggestion[];
  }, []);

  // Already-tagged people are filtered out AFTER ranking, so changing the tag
  // list never invalidates the cache or refires the search.
  const existingKey = existingTags.join(',');
  const filter = useMemo(() => {
    const taken = new Set(existingKey ? existingKey.split(',') : []);
    return (rows: PersonSuggestion[]) => rows.filter(p => !taken.has(p.id));
  }, [existingKey]);

  const {
    query: searchQuery,
    setQuery: setSearchQuery,
    items: searchResults,
    loading,
    reset: resetSearch,
  } = useTypeahead<PersonSuggestion>({
    scope: 'people:public',
    fetcher,
    narrow: rankPeople,
    filter,
  });


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
      resetSearch();
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

  if (variant === 'mech') {
    const count = selectedProfiles.length;
    const typed = searchQuery.trim().length >= 1;
    return (
      <div className="ea-mech ea-mech-overlay fixed inset-0 z-[60] flex items-center justify-center p-4" data-tag-people="mech">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tag-people-title"
          className="flex max-h-modal w-full max-w-[400px] flex-col gap-3 rounded-[20px] p-4"
          style={{ backgroundColor: 'var(--mech-panel)', border: '1px solid var(--mech-hairline)', boxShadow: 'var(--mech-dialog-depth)' }}
        >
          <div className="flex h-11 shrink-0 items-center justify-between">
            <h2 id="tag-people-title" className="text-lg font-bold text-[color:var(--mech-text)]">Tag People</h2>
            <button type="button" onClick={onClose} aria-label="Close" className="ea-mech-close inline-flex items-center justify-center">
              <FaIcon icon={faXmark} />
            </button>
          </div>

          <label className="ea-mech-recess flex h-12 shrink-0 items-center gap-2.5 rounded-[14px] px-3.5">
            <FaIcon icon={faMagnifyingGlass} className="text-[18px] text-[color:var(--mech-label)]" />
            <span className="sr-only">Search people</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search people"
              autoComplete="off"
              className="ea-mech-slot-input h-full w-full min-w-0 text-base sm:text-[15px]"
              data-tag-people-search=""
            />
          </label>

          {/* Capped: many selections must not starve the results below. */}
          {count > 0 && (
            <ul className="flex max-h-[88px] shrink-0 flex-wrap gap-2 overflow-y-auto overscroll-contain py-0.5" data-tag-people-selected="">
              {selectedProfiles.map(profile => (
                <li key={profile.id}>
                  <button
                    type="button"
                    onClick={() => toggleProfile(profile)}
                    aria-label={`Remove ${getDisplayName(profile)}`}
                    className="ea-mech-chip relative inline-flex h-8 max-w-full items-center gap-1.5 rounded-2xl pl-1.5 pr-2.5 before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-['']"
                    data-tag-people-chip={profile.id}
                  >
                    <AvatarImage src={profile.avatar_url ?? undefined} alt="" size={20} fallbackInitials={getInitials(getDisplayName(profile))} />
                    <span className="min-w-0 truncate text-[13px] font-medium">{getDisplayName(profile)}</span>
                    <FaIcon icon={faXmark} className="text-[12px] text-[color:var(--mech-close-icon)]" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* The dialog's only scroll area. */}
          <div className="min-h-[136px] flex-1 overflow-y-auto overscroll-contain" data-tag-people-results="">
            {loading && (
              <div className="flex h-[136px] items-center justify-center">
                <FaIcon icon={faSpinner} spin className="text-2xl text-[color:var(--mech-chevron)]" />
              </div>
            )}
            {!loading && (!typed || searchResults.length === 0) && (
              <div className="flex h-[136px] flex-col items-center justify-center gap-2" data-tag-people-empty={typed ? 'none' : 'idle'}>
                <FaIcon icon={faMagnifyingGlass} className="text-[28px] text-[color:var(--mech-chevron)]" />
                <p className="text-[13px] text-[color:var(--mech-text-soft)]">{typed ? 'No one found' : 'Type to search for people'}</p>
              </div>
            )}
            {!loading && typed && searchResults.length > 0 && (
              <ul>
                {searchResults.map((profile, i) => {
                  const isSelected = selectedProfiles.some(p => p.id === profile.id);
                  return (
                    <li key={profile.id} style={i > 0 ? { borderTop: '1px solid var(--mech-divider)' } : undefined}>
                      <button
                        type="button"
                        onClick={() => toggleProfile(profile)}
                        aria-pressed={isSelected}
                        className="ea-mech-btn flex h-14 w-full items-center gap-3 text-left"
                        data-tag-people-row={profile.id}
                      >
                        <AvatarImage src={profile.avatar_url ?? undefined} alt="" size={36} fallbackInitials={getInitials(getDisplayName(profile))} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--mech-text)]">{getDisplayName(profile)}</span>
                        <span aria-hidden="true" className="ea-mech-check inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px]" {...(isSelected ? { 'data-on': '' } : {})}>
                          <FaIcon icon={faCheck} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="ea-mech-btn h-12 rounded-[14px] px-3 text-[15px] font-medium text-[color:var(--mech-text-soft)]">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={count === 0 || submitting}
              className="ea-mech-next h-12 min-w-[112px] px-4"
              data-tag-people-submit=""
            >
              {submitting ? 'Tagging…' : count > 0 ? `Tag (${count})` : 'Tag'}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
            <FaIcon icon={faXmark} className="text-xl" />
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
            <FaIcon icon={faMagnifyingGlass} className="absolute left-3 top-3 text-decor" />
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
                    aria-label={`Remove ${getDisplayName(profile)}`}
                    className="text-faint hover:text-red-600 dark:hover:text-red-400"
                  >
                    <FaIcon icon={faXmark} className="text-xs" />
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
              <FaIcon icon={faSpinner} spin className="text-2xl text-decor" />
            </div>
          )}

          {!loading && searchQuery.trim().length < 1 && (
            <div className="p-8 text-center">
              <FaIcon icon={faMagnifyingGlass} className="text-3xl text-gray-300 dark:text-stone-600 mb-2" />
              <p className="text-tertiary text-sm">Type to search for people</p>
            </div>
          )}

          {!loading && searchQuery.trim().length >= 1 && searchResults.length === 0 && (
            <div className="p-8 text-center">
              <FaIcon icon={faUserSlash} className="text-3xl text-gray-300 dark:text-stone-600 mb-2" />
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
                        unoptimized={!isOptimizableImageSrc(profile.avatar_url)}
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
                      <FaIcon icon={faCircleCheck} className="text-brand-fg text-xl" />
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
                <FaIcon icon={faSpinner} spin className="mr-2" />
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
