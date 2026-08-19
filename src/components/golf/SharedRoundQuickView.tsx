'use client';

import { useState } from 'react';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { isRoundLive, isActiveParticipant, effectiveRoundStatus } from '@/lib/golf/round-status';
import { asGameFormat, calcStablefordTotal, calcMatchStatus, GAME_FORMAT_LABELS } from '@/lib/golf/formats';
import { useEndRound } from '@/hooks/useEndRound';
import { useDeleteRound } from '@/hooks/useDeleteRound';
import { countPartnersWithScores } from '@/lib/golf/round-delete';
import { COPY } from '@/lib/copy';
import LazyImage from '../LazyImage';
import ConfirmModal from '../ConfirmModal';
import type { CompleteGolfScorecard } from '@/types/group-posts';

interface SharedRoundQuickViewProps {
  scorecard: CompleteGolfScorecard;
  onExpand: () => void;
  currentUserId?: string;
  /** True when the last live refresh failed AND the round is still live —
   *  already gated by `useSharedRound`, so this surface just renders it. */
  stale?: boolean;
  /** Called after the creator ends the round from this card. */
  onStatusChange?: () => void;
  /** Called after the creator deletes the round from this card. Also GATES
   *  the Delete button — surfaces that don't pass it (feed/profile cards)
   *  don't get the button and keep deleting via the post trash instead. */
  onDeleted?: () => void;
}

export default function SharedRoundQuickView({
  scorecard,
  onExpand,
  currentUserId,
  stale = false,
  onStatusChange,
  onDeleted
}: SharedRoundQuickViewProps) {
  const { group_post, golf_data, participants } = scorecard;
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { endRound, ending } = useEndRound(group_post.id, onStatusChange);
  const { deleteRound, deleting } = useDeleteRound(group_post.id, onDeleted);

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
  const mediaCount = scorecard.media?.length ?? 0;

  return (
    <div className="bg-surface rounded-lg p-4 mt-3 border border-border">
      {/* Connection notice. It lives on this PERSISTENT card rather than in the
          scorecard modal: "we lost touch, scores may have moved on" is about
          the round still running, so it belongs where the round is always
          visible, not in a transient overlay — and never beside a FINAL badge.
          `stale` arrives already gated on liveness by useSharedRound. */}
      {stale && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-200">
          <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
          <span>Updates paused — showing the last scores we could load.</span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <i className="fas fa-users text-faint text-base"></i>
            <span className="font-bold text-primary text-base">{golf_data.course_name}</span>

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
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-700 text-white text-xs font-bold rounded-full">
                <i className={`fas ${gameFormat === 'stableford' ? 'fa-star' : 'fa-people-arrows'} text-[10px]`}></i>
                {GAME_FORMAT_LABELS[gameFormat].toUpperCase()}
              </span>
            )}

            {/* Round Type Badge */}
            {golf_data.round_type === 'indoor' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-700 text-white text-xs font-bold rounded-full">
                <i className="fas fa-warehouse text-[10px]"></i>
                INDOOR
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-700 text-white text-xs font-bold rounded-full">
                <i className="fas fa-tree text-[10px]"></i>
                OUTDOOR
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-tertiary font-semibold">
            <span>{formattedDate}</span>
            <span>•</span>
            <span>{golf_data.holes_played} Holes</span>
            {golf_data.tee_color && (
              <>
                <span>•</span>
                <span>{golf_data.tee_color.charAt(0).toUpperCase() + golf_data.tee_color.slice(1)} Tees</span>
              </>
            )}
            {mediaCount > 0 && (
              <>
                <span>•</span>
                <span><i className="fas fa-camera mr-1"></i>{mediaCount}</span>
              </>
            )}
          </div>
        </div>

        {/* Leader Score Badge — only meaningful with someone to lead. In a solo
            round this repeated the player's own row below it, which is half of
            why the score appeared twice within a few inches. Match play uses
            the status banner instead. */}
        {leader && leader.scores.total_score !== null && gameFormat !== 'match' && statusCounts.confirmed > 1 && (
          <div className="ml-3 flex-shrink-0">
            <div className="bg-surface-muted rounded-lg px-3 py-1.5 border border-border text-center">
              <div className="text-xs text-muted font-semibold">Leader</div>
              {gameFormat === 'stableford' ? (
                <>
                  <div className="text-2xl font-black text-primary leading-none">
                    {stablefordPointsFor(leader.scores.hole_scores)}
                  </div>
                  <div className="text-xs font-bold text-tertiary">pts</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-black text-primary leading-none">{leader.scores.total_score}</div>
                  {leader.scores.to_par !== null && (
                    <div className={`text-xs font-bold ${leader.scores.to_par < 0 ? 'text-green-600 dark:text-green-400' : leader.scores.to_par > 0 ? 'text-red-600 dark:text-red-400' : 'text-tertiary'}`}>
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
        <div className="flex items-center gap-2 bg-surface-muted border border-border rounded-lg px-3 py-2 mb-3">
          <i className="fas fa-people-arrows text-muted"></i>
          <span className="text-sm font-bold text-primary">
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
          // Badge text hides below sm (icon + title attribute carry the
          // meaning): "Awaiting scores" as shrink-0 text left ~6px for the
          // player's name in a 320px feed card.
          if (participant.status === 'declined') {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-muted" title="Declined">
                <i className="fas fa-times-circle"></i>
                <span className="hidden sm:inline">Declined</span>
              </span>
            );
          } else if (scores.total_score !== null) {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-muted" title="Confirmed">
                <i className="fas fa-check-circle"></i>
                <span className="hidden sm:inline">Confirmed</span>
              </span>
            );
          } else {
            statusBadge = (
              <span className="flex items-center gap-1 text-xs font-semibold text-brand-fg" title="Awaiting scores">
                <i className="fas fa-clock"></i>
                <span className="hidden sm:inline">Awaiting scores</span>
              </span>
            );
          }

          return (
            <div
              key={participant.id}
              className="flex items-center justify-between bg-surface/60 rounded px-3 py-1.5"
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
                  <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-stone-800 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-tertiary">
                      {getInitials(displayName)}
                    </span>
                  </div>
                )}

                {/* Name */}
                <span className="font-bold text-primary text-sm truncate">{displayName}</span>

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
                      <span className="text-lg font-black text-primary">
                        {stablefordPointsFor(scores.hole_scores)}
                      </span>
                      <span className="text-xs font-bold text-tertiary">pts</span>
                      <span className="text-xs text-muted ml-1">({scores.total_score})</span>
                    </>
                  ) : (
                    <>
                      <span className="text-lg font-black text-primary">{scores.total_score}</span>
                      {/* SEMANTIC COLOUR — DO NOT NEUTRALISE: under/over par. */}
                      {scores.to_par !== null && (
                        <span className={`text-sm font-bold ${scores.to_par < 0 ? 'text-green-600 dark:text-green-400' : scores.to_par > 0 ? 'text-red-600 dark:text-red-400' : 'text-tertiary'}`}>
                          ({scores.to_par >= 0 ? '+' : ''}{scores.to_par})
                        </span>
                      )}
                    </>
                  )}
                  {scores.holes_completed < golf_data.holes_played && (
                    <span className="text-xs text-tertiary ml-1">
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
      <div className="flex items-center justify-between bg-surface/40 rounded px-3 py-2 mb-3 text-xs">
        <div className="flex items-center gap-4">
          <div>
            <span className="font-semibold text-muted">Participants: </span>
            <span className="font-bold text-primary">{participants.length}</span>
          </div>
          {statusCounts.confirmed > 0 && (
            <div>
              <span className="font-semibold text-muted">Confirmed: </span>
              <span className="font-bold text-primary">{statusCounts.confirmed}</span>
            </div>
          )}
          {statusCounts.declined > 0 && (
            <div>
              <span className="font-semibold text-tertiary">Declined: </span>
              <span className="font-bold text-secondary">{statusCounts.declined}</span>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Actions. flex-wrap: for an owner of a live round this row holds three
          buttons (~300px intrinsic) — inside a 320px feed card they wrap to a
          second line instead of overflowing sideways. */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          onClick={onExpand}
          className="flex-1 flex items-center justify-center gap-2 bg-brand hover:bg-brand-hover text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm min-h-[44px]"
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
            className="flex items-center justify-center gap-2 bg-brand hover:bg-brand-hover text-white font-bold py-2 px-4 rounded-lg transition-colors text-sm min-h-[44px]"
            aria-label="Manage participants"
          >
            <i className="fas fa-cog"></i>
            Manage
          </button>
        )}

        {/* Delete Round — the way OUT of a round that shouldn't exist,
            including the 'pending' zero-score round that can't even be
            ended. Completed rounds delete via the post trash instead (the
            post is back in the feed by then), so this hides on completed. */}
        {isOwner && group_post.status !== 'completed' && onDeleted && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleting}
            className="flex items-center justify-center gap-2 border border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-60 font-bold py-2 px-4 rounded-lg transition-colors text-sm min-h-[44px]"
            aria-label="Delete round"
          >
            <i className={`fas ${deleting ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i>
            Delete
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

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title={COPY.FORMS.DELETE_ROUND_TITLE}
        message={
          countPartnersWithScores(participants, group_post.creator_id) > 0
            ? COPY.FORMS.DELETE_ROUND_CONFIRM_PARTNERS(
                countPartnersWithScores(participants, group_post.creator_id)
              )
            : COPY.FORMS.DELETE_ROUND_CONFIRM
        }
        confirmText={COPY.FORMS.DELETE_ROUND_ACTION}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          deleteRound();
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
