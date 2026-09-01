'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getInitials } from '@/lib/formatters';
import LazyImage from './LazyImage';
import FollowButton from './FollowButton';

interface Suggestion {
  suggested_id: string;
  suggested_name: string;
  suggested_avatar: string | null;
  suggested_sport: string | null;
  suggested_school: string | null;
  similarity_score: number;
  reason: string;
}

interface ConnectionSuggestionsProps {
  profileId: string;
  limit?: number;
  compact?: boolean;
}

export default function ConnectionSuggestions({
  profileId,
  limit = 5,
  compact = false
}: ConnectionSuggestionsProps) {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Inlined cancellable IIFE (the lint rule flags the call site of any
  // function containing setState when invoked from an effect).
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/suggestions?profileId=${profileId}&limit=${limit}`);
        if (response.ok) {
          const data = await response.json();
          if (!cancelled) setSuggestions(data.suggestions || []);
        } else {
          console.error('Failed to load connection suggestions — status:', response.status);
        }
      } catch (e) {
        console.error('Failed to load connection suggestions:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, limit]);

  // C2 (Sep 2026): a dismissal was one mistap from permanent. The last
  // dismissed suggestion is held for a short undo window; Undo restores
  // both the server flag and the row in place.
  const [lastDismissed, setLastDismissed] = useState<Suggestion | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleDismiss = async (suggestedId: string) => {
    try {
      await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId,
          suggestedProfileId: suggestedId,
          action: 'dismiss'
        })
      });

      const dismissed = suggestions.find(s => s.suggested_id === suggestedId) ?? null;
      setDismissedIds(prev => new Set(prev).add(suggestedId));
      setSuggestions(prev => prev.filter(s => s.suggested_id !== suggestedId));
      setLastDismissed(dismissed);
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setLastDismissed(null), 8000);
    } catch (e) {
      console.error('Failed to dismiss connection suggestion:', e);
    }
  };

  const handleUndoDismiss = async () => {
    const restored = lastDismissed;
    if (!restored) return;
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setLastDismissed(null);
    // Optimistic: the row comes back immediately; the server flag follows.
    setDismissedIds(prev => {
      const next = new Set(prev);
      next.delete(restored.suggested_id);
      return next;
    });
    setSuggestions(prev =>
      prev.some(s => s.suggested_id === restored.suggested_id) ? prev : [restored, ...prev]
    );
    try {
      await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId,
          suggestedProfileId: restored.suggested_id,
          action: 'undismiss'
        })
      });
    } catch (e) {
      console.error('Failed to restore connection suggestion:', e);
    }
  };

  const visibleSuggestions = suggestions.filter(s => !dismissedIds.has(s.suggested_id));

  if (loading) {
    return (
      <div className={`bg-surface rounded-lg shadow-sm border border-border ${compact ? 'p-4' : 'p-6'}`}>
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 dark:bg-stone-800 rounded w-3/4 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gray-200 dark:bg-stone-800 rounded-full"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 dark:bg-stone-800 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 dark:bg-stone-800 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (visibleSuggestions.length === 0 && !lastDismissed) {
    return null; // Don't show empty state (but keep the undo strip alive)
  }

  return (
    <div className={`bg-surface rounded-lg shadow-sm border border-border ${compact ? 'p-4' : 'p-6'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className={`font-bold text-primary ${compact ? 'text-base' : 'text-lg'}`}>
          <i className="fas fa-user-friends text-brand-fg mr-2"></i>
          Suggested Connections
        </h3>
      </div>

      {/* Suggestions List */}
      <div className="space-y-3">
        {lastDismissed && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-surface-muted text-sm text-secondary">
            <span className="min-w-0 truncate">Suggestion dismissed.</span>
            <button
              type="button"
              onClick={() => void handleUndoDismiss()}
              className="min-h-[36px] px-3 rounded-full font-semibold text-brand-fg hover:bg-surface-sunken transition-colors"
            >
              Undo
            </button>
          </div>
        )}
        {visibleSuggestions.map(suggestion => (
          <div
            key={suggestion.suggested_id}
            className="flex flex-wrap items-center gap-3 p-3 bg-surface-muted rounded-lg hover:bg-surface-sunken transition-colors min-h-[72px]"
          >
            {/* Avatar */}
            <button
              onClick={() => {
                // Navigate to own profile if clicking own profile
                if (profileId === suggestion.suggested_id) {
                  router.push('/athlete');
                } else {
                  router.push(`/athlete/${suggestion.suggested_id}`);
                }
              }}
              className="flex-shrink-0"
            >
              {suggestion.suggested_avatar ? (
                <LazyImage
                  src={suggestion.suggested_avatar}
                  alt={suggestion.suggested_name}
                  className="w-12 h-12 rounded-full object-cover"
                  width={48}
                  height={48}
                />
              ) : (
                <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-semibold">
                    {getInitials(suggestion.suggested_name)}
                  </span>
                </div>
              )}
            </button>

            {/* Info. flex-1 + min-w-0 and nothing else: the old
                max-w-[calc(100%-200px)] clamp assumed a wide card — inside
                onboarding's compact card at 320px it squeezed the name column
                to ~16px, one ellipsis wide. */}
            <div className="flex-1 min-w-0">
              <button
                onClick={() => {
                  // Navigate to own profile if clicking own profile
                  if (profileId === suggestion.suggested_id) {
                    router.push('/athlete');
                  } else {
                    router.push(`/athlete/${suggestion.suggested_id}`);
                  }
                }}
                className="font-semibold text-primary hover:text-brand-fg truncate block text-sm w-full text-left"
              >
                {suggestion.suggested_name}
              </button>

              {(suggestion.suggested_sport || suggestion.suggested_school) && (
                <p className="text-xs text-tertiary truncate mt-0.5">
                  {suggestion.suggested_sport}
                  {suggestion.suggested_sport && suggestion.suggested_school && ' • '}
                  {suggestion.suggested_school}
                </p>
              )}

              <p className="text-xs text-brand-fg mt-1 truncate">
                <i className="fas fa-lightbulb mr-1"></i>
                {suggestion.reason}
              </p>
            </div>

            {/* Actions. No fixed width: "Become a Fan" + the 44px dismiss are
                ~150px, which overflowed the old w-[120px] box. shrink-0 keeps
                the buttons whole; the row's flex-wrap drops them to their own
                line when the card is too narrow to share one. */}
            <div className="flex items-center gap-1 flex-shrink-0 ml-auto">
              <FollowButton
                profileId={suggestion.suggested_id}
                currentUserId={profileId}
                size="sm"
                onFollowChange={(isFollowing) => {
                  // Only dismiss once they actually followed — an unfollow
                  // used to permanently dismiss the suggestion too
                  if (isFollowing) handleDismiss(suggestion.suggested_id);
                }}
              />
              <button
                onClick={() => handleDismiss(suggestion.suggested_id)}
                className="text-xs text-muted hover:text-secondary min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Dismiss suggestion"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* View All Link (if compact) */}
      {compact && visibleSuggestions.length >= limit && (
        <button
          onClick={() => router.push('/app/suggestions')}
          className="w-full mt-4 text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
        >
          View all suggestions
        </button>
      )}
    </div>
  );
}
