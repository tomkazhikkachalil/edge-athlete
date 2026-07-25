'use client';

import { useState } from 'react';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { isRoundLive, isActiveParticipant, effectiveRoundStatus } from '@/lib/golf/round-status';
import { asGameFormat, calcStablefordTotal, calcMatchStatus, GAME_FORMAT_LABELS } from '@/lib/golf/formats';
import { useEndRound } from '@/hooks/useEndRound';
import LazyImage from '../LazyImage';
import ConfirmModal from '../ConfirmModal';
import type { CompleteGolfScorecard } from '@/types/group-posts';

interface SharedRoundQuickViewProps {
  scorecard: CompleteGolfScorecard;
  onExpand: () => void;
  currentUserId?: string;
  /** Called after the creator ends the round from this card. */
  onStatusChange?: () => void;
}

export default function SharedRoundQuickView({
  scorecard,
  onExpand,
  currentUserId,
  onStatusChange
}: SharedRoundQuickViewProps) {
  const { group_post, golf_data, participants } = scorecard;
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const { endRound, ending } = useEndRound(group_post.id, onStatusChange);

  // Filter confirmed participants with scores
  const confirmedWithScores = participants.filter(
    p => isActiveParticipant(p.participant.status) && p.scores.total_score !== null
  );

  // Count participants by the playing-roster rule (everyone but 'declined'
  // is in — legacy 'pending'/'maybe' rows can score under auto-confirm, so
  // counting them separately would double-count them).
  const statusCounts = {
    confirmed: participants.filter(p => isActiveParticipant(p.participant.status)).length,
    declined: participants.filter(p => p.participant.status === 'declined').length,
  };

  // Format date
  const formattedDate = new Date(group_post.date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  // Game format shapes how the leaderboard reads: stroke (lowest total),
  // stableford (highest points), match (head-to-head status, 2 scorers).
  const gameFormat = asGameFormat(golf_data.game_format);

  const stablefordPointsFor = (holeScores: { hole_number: number; strokes: number }[] | undefined) =>
    calcStablefordTotal(holeScores || []).points;

  // Find leader — lowest strokes, or highest points under stableford
  const leader = confirmedWithScores.length > 0
    ? confirmedWithScores.reduce((prev, curr) => {
        if (gameFormat === 'stableford') {
          return stablefordPointsFor(curr.scores.hole_scores) > stablefordPointsFor(prev.scores.hole_scores)
            ? curr : prev;
        }
        return (curr.scores.total_score || Infinity) < (prev.scores.total_score || Infinity) ? curr : prev;
      })
    : null;

  // Match play status — only meaningful head-to-head (exactly 2 players with scores)
  const matchScorers = gameFormat === 'match'
    ? participants.filter(p => isActiveParticipant(p.participant.status) && (p.scores.hole_scores?.length || 0) > 0)
    : [];
  const matchStatus = matchScorers.length === 2
    ? calcMatchStatus(matchScorers[0].scores.hole_scores, matchScorers[1].scores.hole_scores, golf_data.holes_played)
    : null;
  const matchLeaderName = matchStatus && matchStatus.leaderIndex !== null
    ? formatDisplayName(
        matchScorers[matchStatus.leaderIndex].participant.profile!.first_name,
        null,
        matchScorers[matchStatus.leaderIndex].participant.profile!.last_name,
        matchScorers[matchStatus.leaderIndex].participant.profile!.full_name
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

            {/* Round lifecycle badge: LIVE while scores are streaming in,
                FINAL once everyone who scored has finished */}
            {isRoundLive(group_post) && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded-full">
                <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" aria-hidden="true"></span>
                LIVE
              </span>
            )}
            {effectiveRoundStatus(group_post) === 'completed' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-700 text-white text-xs font-bold rounded-full">
                <i className="fas fa-flag-checkered text-[10px]"></i>
                FINAL
              </span>
            )}

            {/* Game Format Badge (stroke play is the default — no badge) */}
            {gameFormat !== 'stroke' && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full">
                <i className={`fas ${gameFormat === 'stableford' ? 'fa-star' : 'fa-people-arrows'} text-[10px]`}></i>
                {GAME_FORMAT_LABELS[gameFormat].toUpperCase()}
              </span>
            )}

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

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-green-800 font-semibold">
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

        {/* Leader Score Badge (if any) — match play uses the status banner instead */}
        {leader && leader.scores.total_score !== null && gameFormat !== 'match' && (
          <div className="ml-3 flex-shrink-0">
            <div className="bg-white rounded-lg px-3 py-1.5 shadow-md border-2 border-green-300 text-center">
              <div className="text-xs text-green-700 font-semibold">Leader</div>
              {gameFormat === 'stableford' ? (
                <>
                  <div className="text-2xl font-black text-green-900 leading-none">
                    {stablefordPointsFor(leader.scores.hole_scores)}
                  </div>
                  <div className="text-xs font-bold text-gray-600">pts</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-black text-green-900 leading-none">{leader.scores.total_score}</div>
                  {leader.scores.to_par !== null && (
                    <div className={`text-xs font-bold ${leader.scores.to_par < 0 ? 'text-blue-600' : leader.scores.to_par > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                      {leader.scores.to_par >= 0 ? '+' : ''}{leader.scores.to_par}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Match play status banner */}
      {matchStatus && matchStatus.thru > 0 && (
        <div className="flex items-center gap-2 bg-white/70 border border-purple-300 rounded-lg px-3 py-2 mb-3">
          <i className="fas fa-people-arrows text-purple-600"></i>
          <span className="text-sm font-bold text-purple-900">
            {matchStatus.leaderIndex === null
              ? matchStatus.summary
              : `${matchLeaderName} ${matchStatus.final ? 'wins' : ''} ${matchStatus.summary}`.replace(/\s+/g, ' ')}
          </span>
        </div>
      )}

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

          // Status badge follows the same roster rule as the counters:
          // declined is the only non-playing state; every other participant
          // is in the round (auto-confirm) and just may not have scores yet.
          let statusBadge = null;
          if (participant.status === 'declined') {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-gray-500">
                <i className="fas fa-times-circle"></i>
                Declined
              </span>
            );
          } else if (scores.total_score !== null) {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-green-700">
                <i className="fas fa-check-circle"></i>
                Confirmed
              </span>
            );
          } else {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-blue-600">
                <i className="fas fa-clock"></i>
                Awaiting scores
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

                {/* Status Badge — flex-shrink-0 so a long name truncates
                    instead of eating the badge */}
                <div className="ml-2 flex-shrink-0">
                  {statusBadge}
                </div>
              </div>

              {/* Score — stableford leads with points, others with strokes */}
              {scores.total_score !== null && (
                <div className="ml-2 flex items-baseline gap-1 flex-shrink-0">
                  {gameFormat === 'stableford' ? (
                    <>
                      <span className="text-lg font-black text-green-900">
                        {stablefordPointsFor(scores.hole_scores)}
                      </span>
                      <span className="text-xs font-bold text-gray-600">pts</span>
                      <span className="text-xs text-gray-500 ml-1">({scores.total_score})</span>
                    </>
                  ) : (
                    <>
                      <span className="text-lg font-black text-green-900">{scores.total_score}</span>
                      {scores.to_par !== null && (
                        <span className={`text-sm font-bold ${scores.to_par < 0 ? 'text-green-600' : scores.to_par > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                          ({scores.to_par >= 0 ? '+' : ''}{scores.to_par})
                        </span>
                      )}
                    </>
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

      {/* Summary Stats — pointless for a solo round (always "1 of 1") */}
      {statusCounts.confirmed > 1 && (
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
          {statusCounts.declined > 0 && (
            <div>
              <span className="font-semibold text-gray-600">Declined: </span>
              <span className="font-bold text-gray-700">{statusCounts.declined}</span>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={onExpand}
          className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm"
        >
          <i className="fas fa-table"></i>
          View Full Scorecard
        </button>

        {/* End Round — visible right on the card so a creator never has to
            discover the modal to finish a partial round. Keyed on RAW status
            (the persistence escape hatch even when display already says FINAL
            via the 6h auto-end rule). */}
        {isOwner && group_post.status === 'active' && (
          <button
            onClick={() => setShowEndConfirm(true)}
            disabled={ending}
            className="flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-800 disabled:opacity-60 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm min-h-[44px]"
            aria-label="End round"
          >
            <i className={`fas ${ending ? 'fa-spinner fa-spin' : 'fa-flag-checkered'}`}></i>
            End Round
          </button>
        )}

        {isOwner && (
          <button
            onClick={onExpand}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm min-h-[44px]"
            aria-label="Manage participants"
          >
            <i className="fas fa-cog"></i>
            Manage
          </button>
        )}
      </div>

      <ConfirmModal
        isOpen={showEndConfirm}
        title="End this round?"
        message="The round will be marked as final. Scores can still be edited afterwards."
        confirmText="End Round"
        onConfirm={() => {
          setShowEndConfirm(false);
          endRound();
        }}
        onCancel={() => setShowEndConfirm(false)}
      />
    </div>
  );
}
