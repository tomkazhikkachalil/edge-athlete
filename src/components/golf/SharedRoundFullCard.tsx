'use client';

import { useMemo, useState } from 'react';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { classifyScore, SCORE_CELL_RING, holePar } from '@/lib/golf/scoring';
import { isRoundLive, isActiveParticipant, effectiveRoundStatus } from '@/lib/golf/round-status';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { asGameFormat, calcStablefordTotal, calcMatchStatus, GAME_FORMAT_LABELS } from '@/lib/golf/formats';
import ConfirmModal from '../ConfirmModal';
import MediaTile from '../media/MediaTile';
import MediaLightbox from '../media/MediaLightbox';
import { toCollageItems, groupMediaBySegment, type RoundCollageItem } from '@/lib/golf/round-media';
import { segmentLabel } from '@/lib/sports/segment-schemas';
import LazyImage from '../LazyImage';
import type { CompleteGolfScorecard } from '@/types/group-posts';

interface SharedRoundFullCardProps {
  scorecard: CompleteGolfScorecard;
  currentUserId?: string;
  onClose: () => void;
  onAddScores?: (participantId: string) => void;
  /** Called after the creator ends the round so the parent refetches the scorecard. */
  onStatusChange?: () => void;
}

export default function SharedRoundFullCard({
  scorecard,
  currentUserId,
  onClose,
  onAddScores,
  onStatusChange
}: SharedRoundFullCardProps) {
  const { group_post, golf_data, participants } = scorecard;
  // Mounted only while open — lock background scroll for the whole lifetime
  useBodyScrollLock();

  const [activeTab, setActiveTab] = useState<'overview' | 'scorecard'>('overview');
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [endingRound, setEndingRound] = useState(false);
  const [endRoundError, setEndRoundError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Flat, view-ready list — ordered by hole so the lightbox's prev/next walks
  // the round the way it was played, not the order rows happen to come back in.
  const roundMediaItems = useMemo(() => toCollageItems(scorecard.media), [scorecard.media]);
  const mediaBySegment = useMemo(() => groupMediaBySegment(roundMediaItems), [roundMediaItems]);

  const roundLive = isRoundLive(group_post);
  const isCreator = currentUserId === group_post.creator_id;

  // Game format drives the leaderboard: stroke (lowest strokes), stableford
  // (highest points), match (head-to-head status banner, 2 scorers).
  const gameFormat = asGameFormat(golf_data.game_format);
  const stablefordPointsFor = (holeScores: { hole_number: number; strokes: number }[] | undefined) =>
    calcStablefordTotal(holeScores || []).points;

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

  // Creator's manual escape hatch for a round left 'active' (e.g. players
  // stopped entering scores mid-round). Normal completion happens
  // automatically server-side when everyone who scored has finished.
  const handleEndRound = async () => {
    setEndingRound(true);
    setEndRoundError(null);
    try {
      const response = await fetch(`/api/group-posts/${group_post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to end round');
      }
      onStatusChange?.();
    } catch (err) {
      console.error('End round failed:', err);
      setEndRoundError(err instanceof Error ? err.message : 'Failed to end round');
    } finally {
      setEndingRound(false);
      setShowEndConfirm(false);
    }
  };

  // Format date
  const formattedDate = new Date(group_post.date).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  // Get all hole numbers present (supports flexible holes)
  const allHoleNumbers = Array.from(
    new Set(
      participants.flatMap(p =>
        p.scores.hole_scores?.map(h => h.hole_number) || []
      )
    )
  ).sort((a, b) => a - b);

  // Split into front 9 and back 9 (if applicable)
  const front9 = allHoleNumbers.filter(h => h <= 9);
  const back9 = allHoleNumbers.filter(h => h > 9);

  // Per-hole par via the shared domain helper — real course pars when the
  // round carries hole_data (migration 039), the documented par-4 fallback
  // for legacy rounds.
  const roundHoleData = golf_data.hole_data ?? null;
  const parFor = (holeNum: number) => holePar(holeNum, roundHoleData);

  // Find current user's participant record
  const currentUserParticipant = participants.find(
    p => p.participant.profile_id === currentUserId
  );

  // The footer exists ONLY to offer scoring. Close is the header X — a second
  // Close button in a footer was half of the two-bar stack that squeezed the
  // scroll area, and duplicating an affordance already on screen adds nothing.
  const canScore = !!currentUserParticipant && !!onAddScores;


  const renderScorecardTable = (holeNumbers: number[], title: string) => {
    if (holeNumbers.length === 0) return null;



    return (
      <div className="mb-4">
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Table Header */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-bold text-gray-700 sticky left-0 bg-gray-50 z-10 min-w-[120px]">
                    {title}
                  </th>
                  {holeNumbers.map(holeNum => (
                    <th key={holeNum} className="text-center py-2 px-2 font-black text-gray-700 min-w-[40px]">
                      {holeNum}
                    </th>
                  ))}
                  <th className="text-center py-2 px-3 font-black text-gray-800 bg-gray-100 min-w-[50px]">
                    {title === 'Front 9' ? 'OUT' : title === 'Back 9' ? 'IN' : 'TOTAL'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Par Row */}
                <tr className="border-b border-gray-200 bg-gray-50">
                  <td className="py-2 px-3 font-bold text-gray-700 sticky left-0 bg-gray-50 z-10">PAR</td>
                  {holeNumbers.map(holeNum => (
                    <td key={holeNum} className="text-center py-2 px-2 font-bold text-gray-900">
                      {parFor(holeNum)}
                    </td>
                  ))}
                  <td className="text-center py-2 px-3 font-black text-gray-800 bg-gray-100">
                    {holeNumbers.reduce((sum, h) => sum + parFor(h), 0)}
                  </td>
                </tr>

                {/* Player Rows */}
                {participants
                  .filter(p => isActiveParticipant(p.participant.status))
                  .map(({ participant, scores }) => {
                    const profile = participant.profile!;
                    const displayName = formatDisplayName(
                      profile.first_name,
                      null,
                      profile.last_name,
                      profile.full_name
                    );

                    // Create map of hole scores
                    const holeScoresMap = new Map(
                      scores.hole_scores?.map(hs => [hs.hole_number, hs]) || []
                    );

                    // Calculate subtotal for these holes
                    const subtotal = holeNumbers.reduce((sum, holeNum) => {
                      const hole = holeScoresMap.get(holeNum);
                      return sum + (hole?.strokes || 0);
                    }, 0);

                    const isCurrentUser = participant.profile_id === currentUserId;

                    return (
                      <tr key={participant.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="py-2 px-3 sticky left-0 bg-white z-10 hover:bg-gray-50">
                          <div className="flex items-center gap-2">
                            {profile.avatar_url ? (
                              <LazyImage
                                src={profile.avatar_url}
                                alt={displayName}
                                className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                                width={24}
                                height={24}
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                                <span className="text-[10px] font-medium text-gray-600">
                                  {getInitials(displayName)}
                                </span>
                              </div>
                            )}
                            <span className={`font-bold text-gray-900 text-xs truncate ${isCurrentUser ? 'text-violet-600' : ''}`}>
                              {displayName}
                              {isCurrentUser && <span className="ml-1">(You)</span>}
                            </span>
                          </div>
                        </td>

                        {holeNumbers.map(holeNum => {
                          const hole = holeScoresMap.get(holeNum);
                          if (!hole) {
                            return (
                              <td key={holeNum} className="text-center py-2 px-2">
                                <span className="text-gray-400 text-xs">-</span>
                              </td>
                            );
                          }

                          const scoreClass = classifyScore(hole.strokes, parFor(holeNum));
                          const cellStyle = scoreClass ? SCORE_CELL_RING[scoreClass] : SCORE_CELL_RING.par;
                          const textColor = cellStyle.text;
                          const border = cellStyle.ring;

                          return (
                            <td key={holeNum} className="text-center py-2 px-1">
                              {/* SEMANTIC COLOUR — DO NOT NEUTRALISE. SCORE_CELL_RING
                            encodes eagle/birdie/bogey/double against par; this is
                            the scorecard's at-a-glance read, not decoration. */}
                        <div className={`${textColor} ${border} bg-white rounded mx-auto w-7 h-7 flex items-center justify-center text-sm`}>
                                {hole.strokes}
                              </div>
                            </td>
                          );
                        })}

                        <td className="text-center py-2 px-3 bg-violet-50">
                          <span className="font-black text-violet-900 text-base">
                            {subtotal || '-'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                {/* Pending/No Scores Rows */}
                {participants
                  .filter(p => isActiveParticipant(p.participant.status) && !p.scores.total_score)
                  .map(({ participant }) => {
                    const profile = participant.profile!;
                    const displayName = formatDisplayName(
                      profile.first_name,
                      null,
                      profile.last_name,
                      profile.full_name
                    );
                    const isCurrentUser = participant.profile_id === currentUserId;

                    return (
                      <tr key={participant.id} className="border-b border-gray-200 bg-gray-50">
                        <td className="py-2 px-3 sticky left-0 bg-gray-50 z-10">
                          <div className="flex items-center gap-2">
                            {profile.avatar_url ? (
                              <LazyImage
                                src={profile.avatar_url}
                                alt={displayName}
                                className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                                width={24}
                                height={24}
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0">
                                <span className="text-[10px] font-medium text-gray-600">
                                  {getInitials(displayName)}
                                </span>
                              </div>
                            )}
                            <span className={`font-bold text-gray-600 text-xs truncate ${isCurrentUser ? 'text-violet-600' : ''}`}>
                              {displayName}
                              {isCurrentUser && <span className="ml-1">(You)</span>}
                            </span>
                          </div>
                        </td>

                        {holeNumbers.map(holeNum => (
                          <td key={holeNum} className="text-center py-2 px-2">
                            <span className="text-gray-400 text-xs">-</span>
                          </td>
                        ))}

                        <td className="text-center py-2 px-3">
                          {isCurrentUser && onAddScores ? (
                            <button
                              onClick={() => onAddScores(participant.id)}
                              className="text-xs text-violet-600 hover:text-violet-800 font-bold px-3 py-2 -m-1 min-h-[40px] rounded-md hover:bg-violet-50"
                            >
                              Add
                            </button>
                          ) : (
                            <span className="text-gray-400 text-xs">Awaiting</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-modal overflow-hidden flex flex-col">
        {/* Header. `shrink-0` so it keeps its height and the SCROLL AREA absorbs
            the overflow instead — without it a tall header squeezes `flex-1`. */}
        <div className="shrink-0 bg-gray-900 text-white p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h2 className="text-2xl font-black">{golf_data.course_name}</h2>
                {roundLive && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-red-600 text-white text-xs font-bold rounded-full">
                    <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" aria-hidden="true"></span>
                    LIVE
                  </span>
                )}
                {effectiveRoundStatus(group_post) === 'completed' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/15 text-white text-xs font-bold rounded-full">
                    <i className="fas fa-flag-checkered text-[10px]"></i>
                    FINAL
                  </span>
                )}
                {gameFormat !== 'stroke' && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white/15 text-white text-xs font-bold rounded-full">
                    <i className={`fas ${gameFormat === 'stableford' ? 'fa-star' : 'fa-people-arrows'} text-[10px]`}></i>
                    {GAME_FORMAT_LABELS[gameFormat].toUpperCase()}
                  </span>
                )}
                {/* The "Updates paused" chip used to live here, un-gated by
                    status, so a FINAL round contradicted itself by claiming its
                    scores might still change. It now renders once, on the
                    persistent surface (QuickView / the /live page), never in
                    this transient modal and never beside the FINAL badge. */}
              </div>
              <div className="flex items-center gap-4 text-sm font-semibold flex-wrap">
                <span>{formattedDate}</span>
                <span>•</span>
                <span>{golf_data.holes_played} Holes</span>
                {golf_data.tee_color && (
                  <>
                    <span>•</span>
                    <span>{golf_data.tee_color.charAt(0).toUpperCase() + golf_data.tee_color.slice(1)} Tees</span>
                  </>
                )}
                <span>
                  {golf_data.round_type === 'indoor' ? (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-white/15 rounded-full text-xs">
                      <i className="fas fa-warehouse"></i>
                      INDOOR
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-white/15 rounded-full text-xs">
                      <i className="fas fa-tree"></i>
                      OUTDOOR
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 ml-4">
              {isCreator && group_post.status === 'active' && (
                <button
                  onClick={() => setShowEndConfirm(true)}
                  disabled={endingRound}
                  className="flex items-center gap-2 bg-white/15 hover:bg-white/25 disabled:opacity-60 text-white text-sm font-bold px-3 py-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] justify-center"
                  aria-label="End round"
                >
                  <i className="fas fa-flag-checkered"></i>
                  {/* Icon-only below sm — the label crowds the modal title at 360px */}
                  <span className="hidden sm:inline">{endingRound ? 'Ending…' : 'End Round'}</span>
                </button>
              )}
              <button
                onClick={onClose}
                className="text-white hover:text-gray-200 text-2xl font-bold min-w-[44px] min-h-[44px] flex items-center justify-center"
                aria-label="Close"
              >
                <i className="fas fa-times"></i>
              </button>
            </div>
          </div>
          {endRoundError && (
            <div className="mt-2 text-sm font-semibold text-red-100 bg-red-600/60 rounded px-3 py-1.5">
              {endRoundError}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="shrink-0 border-b border-gray-300 bg-white">
          <div className="flex px-6">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-6 py-3 font-bold text-sm border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <i className="fas fa-trophy mr-2"></i>
              Overview
            </button>
            <button
              onClick={() => setActiveTab('scorecard')}
              className={`px-6 py-3 font-bold text-sm border-b-2 transition-colors ${
                activeTab === 'scorecard'
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <i className="fas fa-table mr-2"></i>
              Full Scorecard
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        {/* `min-h-0` IS LOAD-BEARING, not tidying. A column flex item defaults to
            `min-height: auto`, which refuses to shrink below its content — so this
            pane grew past the panel's `max-h-modal`, and the panel's
            `overflow-hidden` clipped the bottom rather than letting it scroll.
            That is why "N of 18 holes" was cut in half. Do not remove. */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Match play status banner */}
              {matchStatus && matchStatus.thru > 0 && (
                <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
                  <i className="fas fa-people-arrows text-gray-500 text-lg"></i>
                  <div>
                    <div className="text-base font-black text-gray-900">
                      {matchStatus.leaderIndex === null
                        ? matchStatus.summary
                        : `${matchLeaderName} ${matchStatus.final ? 'wins' : ''} ${matchStatus.summary}`.replace(/\s+/g, ' ')}
                    </div>
                    {!matchStatus.final && (
                      <div className="text-xs font-semibold text-gray-600">
                        {matchStatus.remaining} hole{matchStatus.remaining === 1 ? '' : 's'} remaining
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Leaderboard */}
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <h3 className="text-lg font-black text-gray-900">
                    <i className={`fas ${participants.filter(p => isActiveParticipant(p.participant.status)).length > 1 ? 'fa-trophy' : 'fa-golf-ball'} mr-2`}></i>
                    {participants.filter(p => isActiveParticipant(p.participant.status)).length > 1 ? 'Leaderboard' : 'Your Round'}
                    {gameFormat === 'stableford' && (
                      <span className="ml-2 text-sm font-bold text-gray-500">(points — highest wins)</span>
                    )}
                  </h3>
                </div>
                <div className="divide-y divide-gray-200">
                  {participants
                    .filter(p => isActiveParticipant(p.participant.status) && p.scores.total_score !== null)
                    .sort((a, b) =>
                      gameFormat === 'stableford'
                        ? stablefordPointsFor(b.scores.hole_scores) - stablefordPointsFor(a.scores.hole_scores)
                        : (a.scores.total_score || Infinity) - (b.scores.total_score || Infinity)
                    )
                    .map(({ participant, scores }, index) => {
                      const profile = participant.profile!;
                      const displayName = formatDisplayName(
                        profile.first_name,
                        null,
                        profile.last_name,
                        profile.full_name
                      );
                      const isCurrentUser = participant.profile_id === currentUserId;

                      return (
                        <div key={participant.id} className={`flex items-center gap-4 p-4 ${isCurrentUser ? 'bg-violet-50' : 'hover:bg-gray-50'}`}>
                          {/* Position */}
                          <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
                            {index === 0 ? (
                              <div className="w-10 h-10 bg-gray-900 rounded-full flex items-center justify-center">
                                <i className="fas fa-trophy text-white text-sm"></i>
                              </div>
                            ) : (
                              <span className="text-2xl font-black text-gray-400">{index + 1}</span>
                            )}
                          </div>

                          {/* Avatar */}
                          {profile.avatar_url ? (
                            <LazyImage
                              src={profile.avatar_url}
                              alt={displayName}
                              className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                              width={48}
                              height={48}
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                              <span className="text-white text-sm font-bold">
                                {getInitials(displayName)}
                              </span>
                            </div>
                          )}

                          {/* Name */}
                          <div className="flex-1 min-w-0">
                            <div className={`font-black text-base ${isCurrentUser ? 'text-violet-700' : 'text-gray-900'}`}>
                              {displayName}
                              {isCurrentUser && <span className="ml-2 text-sm">(You)</span>}
                            </div>
                            <div className="text-sm text-gray-600">
                              {scores.holes_completed} of {golf_data.holes_played} holes
                              {scores.scores_confirmed === false && !isCurrentUser && (
                                <span className="ml-2 text-xs text-amber-700">
                                  <i className="fas fa-pen-to-square mr-1"></i>entered by organizer
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Creator keeps the card for the group — classic
                              one-person-scores golf. API attributes via
                              entered_by + scores_confirmed=false. */}
                          {isCreator && !isCurrentUser && onAddScores && (
                            <button
                              onClick={() => onAddScores(participant.id)}
                              className="text-sm font-bold text-violet-600 hover:text-violet-700 px-3 py-2 rounded-lg border border-violet-200 hover:bg-violet-50 transition-colors flex-shrink-0"
                            >
                              Edit
                            </button>
                          )}

                          {/* Score — stableford leads with points, others with strokes */}
                          <div className="text-right">
                            {gameFormat === 'stableford' ? (
                              <>
                                <div className="text-3xl font-black text-gray-900">
                                  {stablefordPointsFor(scores.hole_scores)}
                                  <span className="text-sm font-bold text-gray-500 ml-1">pts</span>
                                </div>
                                <div className="text-sm font-bold text-gray-600">{scores.total_score} strokes</div>
                              </>
                            ) : (
                              <>
                                <div className="text-3xl font-black text-gray-900">{scores.total_score}</div>
                                {/* SEMANTIC COLOUR — DO NOT NEUTRALISE: under/over par. */}
                                {scores.to_par !== null && (
                                  <div className={`text-sm font-bold ${scores.to_par < 0 ? 'text-green-600' : scores.to_par > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                    {scores.to_par >= 0 ? '+' : ''}{scores.to_par}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}

                  {/* Players without scores */}
                  {participants
                    .filter(p => isActiveParticipant(p.participant.status) && !p.scores.total_score)
                    .map(({ participant }) => {
                      const profile = participant.profile!;
                      const displayName = formatDisplayName(
                        profile.first_name,
                        null,
                        profile.last_name,
                        profile.full_name
                      );
                      const isCurrentUser = participant.profile_id === currentUserId;

                      return (
                        <div key={participant.id} className="flex items-center gap-4 p-4 bg-gray-50">
                          <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
                            <span className="text-2xl font-black text-gray-300">-</span>
                          </div>

                          {profile.avatar_url ? (
                            <LazyImage
                              src={profile.avatar_url}
                              alt={displayName}
                              className="w-12 h-12 rounded-full object-cover flex-shrink-0 opacity-60"
                              width={48}
                              height={48}
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0">
                              <span className="text-gray-600 text-sm font-bold">
                                {getInitials(displayName)}
                              </span>
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className={`font-bold text-base ${isCurrentUser ? 'text-violet-700' : 'text-gray-600'}`}>
                              {displayName}
                              {isCurrentUser && <span className="ml-2 text-sm">(You)</span>}
                            </div>
                            <div className="text-sm text-gray-500 italic">
                              {isCurrentUser && onAddScores ? 'Tap to add your scores' : 'Awaiting scores'}
                            </div>
                          </div>

                          {isCreator && !isCurrentUser && onAddScores && (
                            <button
                              onClick={() => onAddScores(participant.id)}
                              className="text-sm font-bold text-violet-600 hover:text-violet-700 px-3 py-2 rounded-lg border border-violet-200 hover:bg-violet-50 transition-colors flex-shrink-0"
                            >
                              Add scores
                            </button>
                          )}

                          {isCurrentUser && onAddScores && (
                            <button
                              onClick={() => onAddScores(participant.id)}
                              className="bg-violet-600 hover:bg-violet-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors"
                            >
                              Add Scores
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Round Details */}
              <div className="bg-white rounded-lg border-2 border-gray-300 p-4">
                <h3 className="text-lg font-black text-gray-900 mb-3">
                  <i className="fas fa-info-circle mr-2"></i>
                  Round Details
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-1">Course</div>
                    <div className="font-bold text-gray-900">{golf_data.course_name}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-1">Date</div>
                    <div className="font-bold text-gray-900">{formattedDate}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-gray-600 mb-1">Holes</div>
                    <div className="font-bold text-gray-900">{golf_data.holes_played}</div>
                  </div>
                  {golf_data.tee_color && (
                    <div>
                      <div className="text-xs font-semibold text-gray-600 mb-1">Tees</div>
                      <div className="font-bold text-gray-900">{golf_data.tee_color.charAt(0).toUpperCase() + golf_data.tee_color.slice(1)}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Scorecard Tab */}
          {activeTab === 'scorecard' && (
            <>
              {front9.length > 0 && renderScorecardTable(front9, front9.length === 9 ? 'Front 9' : 'Holes')}
              {back9.length > 0 && renderScorecardTable(back9, 'Back 9')}

              {/* Total Score Summary */}
              {front9.length > 0 && back9.length > 0 && (
                <div className="bg-violet-100 border-2 border-violet-300 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {participants
                      .filter(p => isActiveParticipant(p.participant.status) && p.scores.total_score)
                      .map(({ participant, scores }) => {
                        const profile = participant.profile!;
                        const displayName = formatDisplayName(
                          profile.first_name,
                          null,
                          profile.last_name,
                          profile.full_name
                        );

                        return (
                          <div key={participant.id} className="text-center">
                            <div className="font-bold text-sm text-violet-900 mb-1">{displayName}</div>
                            <div className="text-3xl font-black text-violet-900">{scores.total_score}</div>
                            {scores.to_par !== null && (
                              <div className={`text-sm font-bold ${scores.to_par < 0 ? 'text-green-600' : scores.to_par > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                ({scores.to_par >= 0 ? '+' : ''}{scores.to_par})
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 mb-4">
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded ring-2 ring-violet-500 ring-inset bg-white"></div>
                  <span>Eagle (-2)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded ring-1 ring-violet-400 ring-inset bg-white"></div>
                  <span>Birdie (-1)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded border border-red-400 bg-white"></div>
                  <span>Bogey (+1)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded ring-2 ring-red-500 ring-inset bg-white"></div>
                  <span>Double+ (+2)</span>
                </div>
              </div>
            </>
          )}

          {/* Round media — hole-tagged photos/videos from the players.
              Tiles CROP to a fixed square (MediaTile renders with `fill`, so no
              image can size its own box — that was the letterboxing bug), and
              videos show a poster + play glyph rather than an inline <video>.
              Playback happens in the lightbox. */}
          {roundMediaItems.length > 0 && (
            <div className="mt-4">
              <h3 className="text-lg font-black text-gray-900 mb-3">
                <i className="fas fa-camera mr-2"></i>
                Round Media
              </h3>
              {mediaBySegment.map(([segment, group]) => (
                <div key={segment ?? 'round'} className="mb-3">
                  {/* The ONLY sport-specific thing here is the word, and it
                      comes from the schema — an innings heading is this same
                      code with a different label. */}
                  <div className="text-xs font-bold text-gray-700 mb-1.5">
                    {segmentLabel('golf', segment)}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {group.map(item => (
                      <MediaTile
                        key={item.id}
                        src={item.url}
                        thumbnailUrl={item.thumbnailUrl}
                        kind={item.kind}
                        durationSeconds={item.durationSeconds}
                        alt={item.alt || 'Round media'}
                        className="aspect-square rounded-lg"
                        onClick={() =>
                          setLightboxIndex(roundMediaItems.findIndex(m => m.id === item.id))
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ONE footer, not two. This was a "Your Score" bar stacked above a
            separate Close bar, together eating ~140px of a 90dvh modal — and
            the round media gallery was rendered INSIDE it, so photos made the
            footer tall enough to squeeze the scroll area. Media now lives in
            the scrollable content; this is an action bar only.

            The score itself is deliberately NOT repeated here: the leaderboard
            above already shows it per player and highlights your own row, so
            for a solo round this was the same number twice, inches apart. */}
        {canScore && (
          <div className="shrink-0 border-t border-gray-300 p-4 bg-gray-50 safe-bottom">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm text-gray-700">
                {!currentUserParticipant!.scores.total_score && (
                  <span className="font-bold text-gray-900">You haven&apos;t added your scores yet</span>
                )}
              </div>
              <button
                onClick={() => onAddScores!(currentUserParticipant!.participant.id)}
                className="shrink-0 bg-violet-600 hover:bg-violet-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
              >
                {currentUserParticipant!.scores.total_score ? 'Edit Scores' : 'Add Scores'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Full-screen viewer. Tiles crop to fill; this contains, because
          cropping something a viewer opened in order to look at would be
          wrong. Videos play here rather than in the grid. */}
      {lightboxIndex !== null && (
        <MediaLightbox
          items={roundMediaItems}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
          footerFor={item => segmentLabel('golf', (item as RoundCollageItem).segment)}
        />
      )}

      {/* End Round confirmation */}
      <ConfirmModal
        isOpen={showEndConfirm}
        title="End Round"
        message="Mark this round as final? The live leaderboard stops updating as LIVE, but players can still add or fix scores afterward."
        confirmText="End Round"
        cancelText="Keep Playing"
        confirmButtonClass="bg-violet-600 hover:bg-violet-700"
        onConfirm={handleEndRound}
        onCancel={() => setShowEndConfirm(false)}
      />
    </div>
  );
}
