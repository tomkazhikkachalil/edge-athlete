'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { formatDisplayName, getInitials } from '@/lib/formatters';
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

  useEffect(() => {
    if (profileId) {
      loadSuggestions();
    }
  }, [profileId, limit]);

  const loadSuggestions = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/suggestions?profileId=${profileId}&limit=${limit}`);

      if (response.ok) {
        const data = await response.json();
        setSuggestions(data.suggestions || []);
      }
    } catch (error) {
      console.error('Error loading suggestions:', error);
    } finally {
      setLoading(false);
    }
  };

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

      setDismissedIds(prev => new Set(prev).add(suggestedId));
      setSuggestions(prev => prev.filter(s => s.suggested_id !== suggestedId));
    } catch (error) {
      console.error('Error dismissing suggestion:', error);
    }
  };

  const visibleSuggestions = suggestions.filter(s => !dismissedIds.has(s.suggested_id));

  if (loading) {
    return (
      <div className={`bg-white rounded-lg shadow-sm border border-gray-200 ${compact ? 'p-4' : 'p-6'}`}>
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-12 h-12 bg-gray-200 rounded-full"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (visibleSuggestions.length === 0) {
    return null; // Don't show empty state
  }

  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-200 ${compact ? 'p-4' : 'p-6'}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className={`font-bold text-gray-900 ${compact ? 'text-base' : 'text-lg'}`}>
          <i className="fas fa-user-friends text-blue-600 mr-2"></i>
          Suggested Connections
        </h3>
      </div>

      {/* Suggestions List */}
      <div className="space-y-3">
        {visibleSuggestions.map(suggestion => (
          <div
            key={suggestion.suggested_id}
            className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {/* Avatar */}
            <button
              onClick={() => router.push(`/athlete/${suggestion.suggested_id}`)}
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
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                  <span className="text-white text-sm font-semibold">
                    {getInitials(suggestion.suggested_name)}
                  </span>
                </div>
              )}
            </button>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <button
                onClick={() => router.push(`/athlete/${suggestion.suggested_id}`)}
                className="font-semibold text-gray-900 hover:text-blue-600 truncate block text-sm"
              >
                {suggestion.suggested_name}
              </button>

              {(suggestion.suggested_sport || suggestion.suggested_school) && (
                <p className="text-xs text-gray-600 truncate mt-0.5">
                  {suggestion.suggested_sport}
                  {suggestion.suggested_sport && suggestion.suggested_school && ' • '}
                  {suggestion.suggested_school}
                </p>
              )}

              <p className="text-xs text-blue-600 mt-1">
                <i className="fas fa-lightbulb mr-1"></i>
                {suggestion.reason}
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 flex-shrink-0">
              <FollowButton
                profileId={suggestion.suggested_id}
                currentUserId={profileId}
                size="sm"
                onFollowChange={() => {
                  // Optionally refresh suggestions or remove this one
                  handleDismiss(suggestion.suggested_id);
                }}
              />
              <button
                onClick={() => handleDismiss(suggestion.suggested_id)}
                className="text-xs text-gray-500 hover:text-gray-700"
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
          className="w-full mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          View all suggestions
        </button>
      )}
    </div>
  );
}
