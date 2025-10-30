'use client';

import { formatDisplayName, getInitials } from '@/lib/formatters';
import LazyImage from '../LazyImage';
import type { CompleteGolfScorecard } from '@/types/group-posts';

interface SharedRoundQuickViewProps {
  scorecard: CompleteGolfScorecard;
  onExpand: () => void;
  currentUserId?: string;
}

export default function SharedRoundQuickView({
  scorecard,
  onExpand,
  currentUserId
}: SharedRoundQuickViewProps) {
  const { group_post, golf_data, participants } = scorecard;

  // Filter confirmed participants with scores
  const confirmedWithScores = participants.filter(
    p => p.participant.status === 'confirmed' && p.scores.total_score !== null
  );

  // Count participants by status
  const statusCounts = {
    confirmed: participants.filter(p => p.participant.status === 'confirmed').length,
    pending: participants.filter(p => p.participant.status === 'pending').length,
    declined: participants.filter(p => p.participant.status === 'declined').length,
  };

  // Format date
  const formattedDate = new Date(group_post.date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // Find leader (lowest score)
  const leader = confirmedWithScores.length > 0
    ? confirmedWithScores.reduce((prev, curr) =>
        (curr.scores.total_score || Infinity) < (prev.scores.total_score || Infinity) ? curr : prev
      )
    : null;

  const isOwner = currentUserId === group_post.creator_id;

  return (
    <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 mt-3 border border-green-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <i className="fas fa-users text-green-600 text-base"></i>
            <span className="font-bold text-green-900 text-base">{golf_data.course_name}</span>

            {/* Round Type Badge */}
            {golf_data.round_type === 'indoor' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full">
                <i className="fas fa-warehouse text-[10px]"></i>
                INDOOR
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-600 text-white text-xs font-bold rounded-full">
                <i className="fas fa-tree text-[10px]"></i>
                OUTDOOR
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-sm text-green-800 font-semibold">
            <span>{formattedDate}</span>
            <span>•</span>
            <span>{golf_data.holes_played} Holes</span>
            {golf_data.tee_color && (
              <>
                <span>•</span>
                <span>{golf_data.tee_color.charAt(0).toUpperCase() + golf_data.tee_color.slice(1)} Tees</span>
              </>
            )}
          </div>
        </div>

        {/* Leader Score Badge (if any) */}
        {leader && leader.scores.total_score !== null && (
          <div className="ml-3">
            <div className="bg-white rounded-lg px-3 py-1.5 shadow-md border-2 border-green-300 text-center">
              <div className="text-xs text-green-700 font-semibold">Leader</div>
              <div className="text-2xl font-black text-green-900 leading-none">{leader.scores.total_score}</div>
              {leader.scores.to_par !== null && (
                <div className={`text-xs font-bold ${leader.scores.to_par < 0 ? 'text-blue-600' : leader.scores.to_par > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                  {leader.scores.to_par >= 0 ? '+' : ''}{leader.scores.to_par}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Participants List */}
      <div className="space-y-2 mb-3">
        {participants.map(({ participant, scores }) => {
          const profile = participant.profile!;
          const displayName = formatDisplayName(
            profile.first_name,
            null,
            profile.last_name,
            profile.full_name
          );

          // Determine status badge
          let statusBadge = null;
          if (participant.status === 'confirmed' && scores.total_score !== null) {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
                <i className="fas fa-check-circle"></i>
                Confirmed
              </span>
            );
          } else if (participant.status === 'confirmed') {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-blue-600">
                <i className="fas fa-clock"></i>
                Awaiting scores
              </span>
            );
          } else if (participant.status === 'pending') {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-yellow-600">
                <i className="fas fa-hourglass-half"></i>
                Pending
              </span>
            );
          } else if (participant.status === 'declined') {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-gray-500">
                <i className="fas fa-times-circle"></i>
                Declined
              </span>
            );
          }

          return (
            <div
              key={participant.id}
              className="flex items-center justify-between bg-white/60 rounded px-3 py-1.5"
            >
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                {/* Avatar */}
                {profile.avatar_url ? (
                  <LazyImage
                    src={profile.avatar_url}
                    alt={displayName}
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                    width={32}
                    height={32}
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-gray-600">
                      {getInitials(displayName)}
                    </span>
                  </div>
                )}

                {/* Name */}
                <span className="font-bold text-gray-900 text-sm truncate">{displayName}</span>

                {/* Status Badge */}
                <div className="ml-2">
                  {statusBadge}
                </div>
              </div>

              {/* Score */}
              {scores.total_score !== null && (
                <div className="ml-2 flex items-baseline gap-1">
                  <span className="text-lg font-black text-green-900">{scores.total_score}</span>
                  {scores.to_par !== null && (
                    <span className={`text-sm font-bold ${scores.to_par < 0 ? 'text-blue-600' : scores.to_par > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                      ({scores.to_par >= 0 ? '+' : ''}{scores.to_par})
                    </span>
                  )}
                  {scores.holes_completed < golf_data.holes_played && (
                    <span className="text-xs text-gray-600 ml-1">
                      thru {scores.holes_completed}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary Stats */}
      <div className="flex items-center justify-between bg-white/40 rounded px-3 py-2 mb-3 text-xs">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-semibold text-green-800">Participants: </span>
            <span className="font-bold text-green-900">{participants.length}</span>
          </div>
          {statusCounts.confirmed > 0 && (
            <div>
              <span className="font-semibold text-green-800">Confirmed: </span>
              <span className="font-bold text-green-900">{statusCounts.confirmed}</span>
            </div>
          )}
          {statusCounts.pending > 0 && (
            <div>
              <span className="font-semibold text-yellow-700">Pending: </span>
              <span className="font-bold text-yellow-800">{statusCounts.pending}</span>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onExpand}
          className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm"
        >
          <i className="fas fa-table"></i>
          View Full Scorecard
        </button>

        {isOwner && statusCounts.pending > 0 && (
          <button
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm"
            title="Manage participants"
          >
            <i className="fas fa-cog"></i>
            Manage
          </button>
        )}
      </div>
    </div>
  );
}
