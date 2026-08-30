'use client';

import { useMemo, useState } from 'react';
import { formatDisplayName, getInitials, parseDateLocal } from '@/lib/formatters';
import { totalPenalties, formatPenaltySummary } from '@/lib/golf/penalties';
import { classifyScore, SCORE_CELL_RING, holePar, bestHoleFor, placements, ordinalLabel } from '@/lib/golf/scoring';
import { pickOverviewMedia } from '@/lib/media/hero';
import { isRoundLive, isActiveParticipant, effectiveRoundStatus } from '@/lib/golf/round-status';
import { holeCountLabel, holeCountValue, playedHoleCount } from '@/lib/golf/round-display';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { asGameFormat, calcStablefordTotal, calcMatchStatus, GAME_FORMAT_LABELS } from '@/lib/golf/formats';
import { useDeleteRound } from '@/hooks/useDeleteRound';
import { countPartnersWithScores } from '@/lib/golf/round-delete';
import { COPY } from '@/lib/copy';
import ConfirmModal from '../ConfirmModal';
import MediaTile from '../media/MediaTile';
import MediaGrid from '../media/MediaGrid';
import RoundMediaManager, { RoundMediaItemControls } from './RoundMediaManager';
import MediaCollage from '../media/MediaCollage';
import MediaLightbox from '../media/MediaLightbox';
import { toCollageItems, groupMediaBySegment, type RoundCollageItem } from '@/lib/golf/round-media';
import { segmentLabel } from '@/lib/sports/segment-schemas';
import LazyImage from '../LazyImage';
import CourseInfoCard from './CourseInfoCard';
import { embeddedCourseToInfo } from '@/lib/golf/course-info';
import type { CompleteGolfScorecard } from '@/types/group-posts';

type RoundTabId = 'overview' | 'scorecard' | 'media';

const TABS: Array<{ id: RoundTabId; label: string; icon: string }> = [
  { id: 'overview', label: 'Overview', icon: 'fas fa-trophy' },
  { id: 'scorecard', label: 'Full Scorecard', icon: 'fas fa-table' },
  // Always present, even with no media: post-round uploads are legal, so the
  // tab is where you go to ADD photos as well as to see them.
  { id: 'media', label: 'Media', icon: 'fas fa-images' },
];

interface SharedRoundFullCardProps {
  scorecard: CompleteGolfScorecard;
  currentUserId?: string;
  onClose: () => void;
  onAddScores?: (participantId: string) => void;
  /** Called after the creator ends the round so the parent refetches the scorecard. */
  onStatusChange?: () => void;
  /** Called after the creator deletes the round. Also GATES the header's
   *  Delete button — surfaces that don't pass it don't get the button. */
  onDeleted?: () => void;
  /**
   * Called after media is added, reassigned or removed — a plain refetch.
   *
   * Deliberately SEPARATE from onStatusChange: on /live that one navigates
   * away to the finished post, which is right when a round ends and very wrong
   * when someone just corrected a photo's hole.
   */
  onMediaChanged?: () => void;
}

/** Placement chip for the leaderboard, in BRAND VIOLET (Tom's call — the
 *  gold/silver/bronze first cut read "cartoony" against the app). Rank is
 *  expressed as a descending ramp of brightness AND polish: 1st is the
 *  lightest violet with the strongest shine and an outer glow; each step
 *  down is darker with less shine; 4th+ is matte with none. Ties share a
 *  rank (placements()). One literal ramp for both themes — brand is brand,
 *  same rule as metal medals and white pills. */
const PLACEMENT_TIERS: Record<number, { chip: string; shine: string | null }> = {
  1: {
    chip: 'bg-gradient-to-b from-violet-300 via-violet-500 to-violet-700 text-white ring-violet-300/80 shadow-lg shadow-violet-500/50',
    shine: 'bg-white/60',
  },
  2: {
    chip: 'bg-gradient-to-b from-violet-500 via-violet-600 to-violet-800 text-white ring-violet-400/60 shadow-md shadow-violet-700/30',
    shine: 'bg-white/35',
  },
  3: {
    chip: 'bg-gradient-to-b from-violet-700 via-violet-800 to-violet-950 text-violet-100 ring-violet-600/50 shadow-sm',
    shine: 'bg-white/20',
  },
};
const PLACEMENT_DEFAULT: { chip: string; shine: string | null } = {
  chip: 'bg-violet-950 text-violet-300 ring-violet-800/60',
  shine: null, // matte — no polish left at 4th and beyond
};

function PlacementBadge({ rank }: { rank: number }) {
  const tier = PLACEMENT_TIERS[rank] ?? PLACEMENT_DEFAULT;
  return (
    <span
      className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full ring-2 ring-inset text-[11px] font-black tracking-tight ${tier.chip}`}
    >
      {tier.shine && (
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-x-1.5 top-1 h-2.5 rounded-full blur-[1.5px] ${tier.shine}`}
        />
      )}
      <span className="relative drop-shadow-sm">{ordinalLabel(rank)}</span>
    </span>
  );
}

export default function SharedRoundFullCard({
  scorecard,
  currentUserId,
  onClose,
  onAddScores,
  onStatusChange,
  onMediaChanged,
  onDeleted
}: SharedRoundFullCardProps) {
  const { group_post, golf_data, participants } = scorecard;
  // Mounted only while open — lock background scroll for the whole lifetime
  useBodyScrollLock();

  const [activeTab, setActiveTab] = useState<RoundTabId>('overview');
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [endingRound, setEndingRound] = useState(false);
  const [endRoundError, setEndRoundError] = useState<string | null>(null);
  const { deleteRound, deleting } = useDeleteRound(group_post.id, onDeleted);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [courseOpen, setCourseOpen] = useState(false);

  // Flat, view-ready list — ordered by hole so the lightbox's prev/next walks
  // the round the way it was played, not the order rows happen to come back in.
  const roundMediaItems = useMemo(() => toCollageItems(scorecard.media), [scorecard.media]);
  const mediaBySegment = useMemo(() => groupMediaBySegment(roundMediaItems), [roundMediaItems]);
  const roundLive = isRoundLive(group_post);
  const isCreator = currentUserId === group_post.creator_id;

  // What the GROUP actually played. golf_data.holes_played is written once at
  // round creation and never recomputed, so a live round created before any
  // score exists claims 18 forever. Union across ACTIVE participants only —
  // a declined player's stale rows must not inflate the round's length.
  const holesActuallyPlayed = playedHoleCount(
    participants
      .filter(p => isActiveParticipant(p.participant.status))
      .flatMap(p => p.scores.hole_scores ?? [])
  );

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

  // Format date. parseDateLocal, not new Date(): group_posts.date is a
  // date-only string, which new Date() reads as UTC midnight — that showed
  // yesterday's date in any US timezone.
  const formattedDate = parseDateLocal(group_post.date).toLocaleDateString('en-US', {
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

  // Curating media is for people IN the round (or its creator) — RLS enforces
  // the same rule server-side; this just avoids showing controls that would
  // 403. Not gated on liveness: adding after the round is the point.
  const canManageMedia = (!!currentUserParticipant || isCreator) && !!onMediaChanged;

  // Overview shows only the best one or two, chosen rather than sliced:
  // video first, then anything from the best-scoring hole, then the earliest.
  // (`is_highlight` — the athlete's explicit override — lands with migration
  // 062; the picker already accepts it.)
  const bestHole = useMemo(
    () => bestHoleFor(currentUserParticipant?.scores.hole_scores, roundHoleData),
    [currentUserParticipant, roundHoleData]
  );
  const overviewMedia = useMemo(
    () => pickOverviewMedia(roundMediaItems.map(m => ({ ...m, segment: m.segment ?? null })), { bestSegment: bestHole }, 2),
    [roundMediaItems, bestHole]
  );
  // Segment -> its media, for the scorecard's media band. Event-level items are
  // excluded: they belong to no column.
  const segmentsWithMedia = useMemo(() => {
    const map = new Map<number, RoundCollageItem[]>();
    for (const [segment, group] of mediaBySegment) {
      if (segment !== null) map.set(segment, group);
    }
    return map;
  }, [mediaBySegment]);



  const renderScorecardTable = (holeNumbers: number[], title: string) => {
    if (holeNumbers.length === 0) return null;



    return (
      <div className="mb-4">
        <div className="bg-surface rounded-lg border border-border overflow-hidden">
          {/* Table Header */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-muted border-b border-border">
                  {/* Narrower sticky column below sm: at 320px the 120px
                      column + the TOTAL column left ~1.75 hole columns
                      visible; 72px shows ~4.5. Names truncate in their cells. */}
                  <th className="text-left py-2 px-2 sm:px-3 font-bold text-secondary sticky left-0 bg-surface-muted z-10 min-w-[72px] sm:min-w-[120px] max-w-[96px] sm:max-w-none">
                    {title}
                  </th>
                  {holeNumbers.map(holeNum => (
                    <th key={holeNum} className="text-center py-2 px-2 font-black text-secondary min-w-[40px]">
                      {holeNum}
                    </th>
                  ))}
                  <th className="text-center py-2 px-3 font-black text-primary bg-surface-sunken min-w-[50px]">
                    {title === 'Front 9' ? 'OUT' : title === 'Back 9' ? 'IN' : 'TOTAL'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Par Row */}
                <tr className="border-b border-border bg-surface-muted">
                  <td className="py-2 px-2 sm:px-3 font-bold text-secondary sticky left-0 bg-surface-muted z-10">PAR</td>
                  {holeNumbers.map(holeNum => (
                    <td key={holeNum} className="text-center py-2 px-2 font-bold text-primary">
                      {parFor(holeNum)}
                    </td>
                  ))}
                  <td className="text-center py-2 px-3 font-black text-primary bg-surface-sunken">
                    {holeNumbers.reduce((sum, h) => sum + parFor(h), 0)}
                  </td>
                </tr>

                {/*
                  MEDIA ROW — a photo from hole 3 appears ON hole 3.

                  This table is players-as-ROWS x holes-as-COLUMNS, so there is
                  no "hole row" to hang a thumbnail on, and a 40px hole column
                  cannot host one. A dedicated band beneath PAR reuses the
                  existing column grid instead, which is why the same code
                  works for an innings or lap band — only segmentLabel changes.

                  Restructuring to hole-per-row was the alternative and was
                  rejected: it would destroy the multi-player comparison this
                  layout exists for.
                */}
                {segmentsWithMedia.size > 0 && (
                  <tr className="border-b border-border">
                    <td className="py-1.5 px-2 sm:px-3 font-bold text-muted text-[11px] uppercase tracking-wide sticky left-0 bg-surface z-10">
                      Media
                    </td>
                    {holeNumbers.map(holeNum => {
                      const group = segmentsWithMedia.get(holeNum);
                      return (
                        <td key={holeNum} className="py-1.5 px-1 align-middle">
                          {group && group.length > 0 ? (
                            <MediaTile
                              src={group[0].url}
                              thumbnailUrl={group[0].thumbnailUrl}
                              kind={group[0].kind}
                              alt={`${segmentLabel('golf', holeNum)} media`}
                              className="aspect-square w-9 rounded mx-auto"
                              sizes="36px"
                              onClick={() =>
                                setLightboxIndex(
                                  roundMediaItems.findIndex(m => m.id === group[0].id)
                                )
                              }
                              overlay={
                                group.length > 1 ? (
                                  <span className="absolute bottom-0 right-0 rounded-tl bg-black/70 px-1 text-[9px] font-bold text-white">
                                    +{group.length - 1}
                                  </span>
                                ) : undefined
                              }
                            />
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="bg-surface-sunken"></td>
                  </tr>
                )}

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

                    // Penalty total across these holes (0 renders nothing)
                    const penaltyTotal = holeNumbers.reduce(
                      (sum, holeNum) => sum + totalPenalties(holeScoresMap.get(holeNum)?.penalties),
                      0
                    );

                    const isCurrentUser = participant.profile_id === currentUserId;

                    return (
                      <tr key={participant.id} className="border-b border-border hover:bg-surface-muted">
                        <td className="py-2 px-2 sm:px-3 sticky left-0 bg-surface z-10 hover:bg-surface-muted">
                          <div className="flex items-center gap-2">
                            {/* Avatar hides below sm — in the 72px phone
                                column the name is the information */}
                            <span className="hidden sm:block shrink-0">
                              {profile.avatar_url ? (
                                <LazyImage
                                  src={profile.avatar_url}
                                  alt={displayName}
                                  className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                                  width={24}
                                  height={24}
                                />
                              ) : (
                                <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-stone-800 flex items-center justify-center flex-shrink-0">
                                  <span className="text-[10px] font-medium text-tertiary">
                                    {getInitials(displayName)}
                                  </span>
                                </div>
                              )}
                            </span>
                            <span className={`font-bold text-primary text-xs min-w-0 truncate ${isCurrentUser ? 'text-brand-fg' : ''}`} title={displayName}>
                              {displayName}
                              {isCurrentUser && <span className="ml-1 inline-block">(You)</span>}
                            </span>
                          </div>
                        </td>

                        {holeNumbers.map(holeNum => {
                          const hole = holeScoresMap.get(holeNum);
                          if (!hole) {
                            return (
                              <td key={holeNum} className="text-center py-2 px-2">
                                <span className="text-faint text-xs">-</span>
                              </td>
                            );
                          }

                          const scoreClass = classifyScore(hole.strokes, parFor(holeNum));
                          const cellStyle = scoreClass ? SCORE_CELL_RING[scoreClass] : SCORE_CELL_RING.par;
                          const textColor = cellStyle.text;
                          const border = cellStyle.ring;

                          const penCount = totalPenalties(hole.penalties);

                          return (
                            <td key={holeNum} className="text-center py-2 px-1">
                              {/* SEMANTIC COLOUR — DO NOT NEUTRALISE. SCORE_CELL_RING
                            encodes eagle/birdie/bogey/double against par; this is
                            the scorecard's at-a-glance read, not decoration. */}
                        <div
                          className={`relative ${textColor} ${border} bg-surface rounded mx-auto w-7 h-7 flex items-center justify-center text-sm`}
                          title={penCount > 0 ? formatPenaltySummary(hole.penalties) : undefined}
                        >
                                {hole.strokes}
                                {penCount > 0 && (
                                  <span className="absolute -top-1 -right-1 text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                                    {penCount}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}

                        <td className="text-center py-2 px-3 bg-brand-soft">
                          <span className="font-black text-violet-900 dark:text-violet-200 text-base">
                            {subtotal || '-'}
                          </span>
                          {penaltyTotal > 0 && (
                            <div className="text-xs text-tertiary">{penaltyTotal} pen</div>
                          )}
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
                      <tr key={participant.id} className="border-b border-border bg-surface-muted">
                        <td className="py-2 px-2 sm:px-3 sticky left-0 bg-surface-muted z-10">
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
                              <div className="w-6 h-6 rounded-full bg-gray-300 dark:bg-stone-700 flex items-center justify-center flex-shrink-0">
                                <span className="text-[10px] font-medium text-tertiary">
                                  {getInitials(displayName)}
                                </span>
                              </div>
                            )}
                            <span className={`font-bold text-tertiary text-xs truncate ${isCurrentUser ? 'text-brand-fg' : ''}`}>
                              {displayName}
                              {isCurrentUser && <span className="ml-1 inline-block">(You)</span>}
                            </span>
                          </div>
                        </td>

                        {holeNumbers.map(holeNum => (
                          <td key={holeNum} className="text-center py-2 px-2">
                            <span className="text-faint text-xs">-</span>
                          </td>
                        ))}

                        <td className="text-center py-2 px-3">
                          {isCurrentUser && onAddScores ? (
                            <button
                              onClick={() => onAddScores(participant.id)}
                              className="text-xs text-brand-fg hover:text-brand-fg-strong font-bold px-3 py-2 -m-1 min-h-[40px] rounded-md hover:bg-brand-soft"
                            >
                              Add
                            </button>
                          ) : (
                            <span className="text-faint text-xs">Awaiting</span>
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
      <div className="bg-surface-raised rounded-lg shadow-2xl max-w-6xl w-full max-h-modal overflow-hidden flex flex-col">
        {/* Header. `shrink-0` so it keeps its height and the SCROLL AREA absorbs
            the overflow instead — without it a tall header squeezes `flex-1`. */}
        <div className="shrink-0 bg-gray-900 text-white p-4 sm:p-6">
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
                <span>{holeCountLabel(holesActuallyPlayed, golf_data.holes_played)}</span>
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
              {/* Delete Round — covers 'pending' too (a zero-score round can't
                  even be ended); completed rounds delete via the post trash. */}
              {isCreator && group_post.status !== 'completed' && onDeleted && (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={deleting}
                  className="flex items-center gap-2 bg-white/15 hover:bg-red-600/80 disabled:opacity-60 text-white text-sm font-bold px-3 py-2 rounded-lg transition-colors min-h-[44px] min-w-[44px] justify-center"
                  aria-label="Delete round"
                >
                  <i className={`fas ${deleting ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i>
                  <span className="hidden sm:inline">Delete</span>
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

        {/* Tabs. Given ARIA here — these were hand-rolled <button>s with no
            tablist/tab/tabpanel roles at all, so a screen reader had no way to
            know they were tabs.

            The strip scrolls sideways below md instead of wrapping: three
            icon+label tabs are ~380px of intrinsic width, which wrapped the
            labels mid-word on every phone. Same pattern as ProfileMediaTabs —
            edge fades signal the off-screen tab, scrollbar stays hidden. */}
        <div className="shrink-0 border-b border-border-strong bg-surface relative">
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-surface to-transparent z-10 pointer-events-none md:hidden" />
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface to-transparent z-10 pointer-events-none md:hidden" />
          <div className="flex overflow-x-auto scrollbar-hide px-4 sm:px-6" role="tablist" aria-label="Round detail sections">
            {TABS.map(tab => {
              const selected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  id={`round-tab-${tab.id}`}
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`round-panel-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 sm:px-6 py-3 font-bold text-sm border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    selected
                      ? 'border-brand text-brand-fg-strong'
                      : 'border-transparent text-tertiary hover:text-primary'
                  }`}
                >
                  <i className={`${tab.icon} mr-2`}></i>
                  {tab.label}
                  {tab.id === 'media' && roundMediaItems.length > 0 && (
                    <span className="ml-1.5 text-xs font-semibold text-muted">
                      {roundMediaItems.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* `min-h-0` IS LOAD-BEARING, not tidying. A column flex item defaults to
            `min-height: auto`, which refuses to shrink below its content — so this
            pane grew past the panel's `max-h-modal`, and the panel's
            `overflow-hidden` clipped the bottom rather than letting it scroll.
            That is why "N of 18 holes" was cut in half. Do not remove. */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-4" id="round-panel-overview" role="tabpanel" aria-labelledby="round-tab-overview">
              {/* MEDIA LEADS. The round's own content — the photos and who
                  played — comes before the reference material; the course
                  details sit collapsed at the bottom (Tom, Aug 2026).
                  Still a TEASER, not the gallery: the page used to get longer
                  and messier the more someone posted, so the rest lives in
                  the Media tab. Self-hides when empty, so a round with no
                  photos opens straight onto the scores. */}
              {roundMediaItems.length > 0 && (
                <div>
                  <MediaCollage
                    items={overviewMedia}
                    max={2}
                    // Hero-sized tiles in a max-w-6xl modal: full-bleed on
                    // phones, up to ~550px each when two share the row.
                    sizes="(max-width: 640px) 100vw, 552px"
                    onSelect={i =>
                      setLightboxIndex(
                        roundMediaItems.findIndex(m => m.id === overviewMedia[i].id)
                      )
                    }
                  />
                  {roundMediaItems.length > overviewMedia.length && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('media')}
                      className="mt-2 text-sm font-semibold text-brand-fg hover:text-brand-fg-strong"
                    >
                      See all {roundMediaItems.length} photos and videos
                    </button>
                  )}
                </div>
              )}
              {/* Match play status banner */}
              {matchStatus && matchStatus.thru > 0 && (
                <div className="flex items-center gap-3 bg-surface-muted border border-border rounded-lg px-4 py-3">
                  <i className="fas fa-people-arrows text-muted text-lg"></i>
                  <div>
                    <div className="text-base font-black text-primary">
                      {matchStatus.leaderIndex === null
                        ? matchStatus.summary
                        : `${matchLeaderName} ${matchStatus.final ? 'wins' : ''} ${matchStatus.summary}`.replace(/\s+/g, ' ')}
                    </div>
                    {!matchStatus.final && (
                      <div className="text-xs font-semibold text-tertiary">
                        {matchStatus.remaining} hole{matchStatus.remaining === 1 ? '' : 's'} remaining
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Leaderboard */}
              <div className="bg-surface rounded-lg border border-border overflow-hidden">
                <div className="bg-surface-muted px-4 py-3 border-b border-border">
                  <h3 className="text-lg font-black text-primary">
                    <i className={`fas ${participants.filter(p => isActiveParticipant(p.participant.status)).length > 1 ? 'fa-trophy' : 'fa-golf-ball'} mr-2`}></i>
                    {participants.filter(p => isActiveParticipant(p.participant.status)).length > 1 ? 'Leaderboard' : 'Your Round'}
                    {gameFormat === 'stableford' && (
                      <span className="ml-2 text-sm font-bold text-muted">(points — highest wins)</span>
                    )}
                  </h3>
                </div>
                <div className="divide-y divide-border">
                  {(() => {
                  const ranked = participants
                    .filter(p => isActiveParticipant(p.participant.status) && p.scores.total_score !== null)
                    .sort((a, b) =>
                      gameFormat === 'stableford'
                        ? stablefordPointsFor(b.scores.hole_scores) - stablefordPointsFor(a.scores.hole_scores)
                        : (a.scores.total_score || Infinity) - (b.scores.total_score || Infinity)
                    );
                  // Tie-aware competition ranking (1, 1, 3, ...) over the same
                  // metric the sort used — equal rounds share a medal.
                  const ranks = placements(
                    ranked.map(p =>
                      gameFormat === 'stableford'
                        ? stablefordPointsFor(p.scores.hole_scores)
                        : (p.scores.total_score || Infinity)
                    )
                  );
                  return ranked.map(({ participant, scores }, index) => {
                      const profile = participant.profile!;
                      const displayName = formatDisplayName(
                        profile.first_name,
                        null,
                        profile.last_name,
                        profile.full_name
                      );
                      const isCurrentUser = participant.profile_id === currentUserId;

                      return (
                        <div key={participant.id} className={`flex items-center gap-4 p-4 ${isCurrentUser ? 'bg-brand-soft' : 'hover:bg-surface-muted'}`}>
                          {/* Placement medal — ties share a rank */}
                          <PlacementBadge rank={ranks[index]} />

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
                            <div className={`font-black text-base ${isCurrentUser ? 'text-brand-fg-strong' : 'text-primary'}`}>
                              {displayName}
                              {isCurrentUser && <span className="ml-2 text-sm inline-block">(You)</span>}
                            </div>
                            <div className="text-sm text-tertiary">
                              {scores.holes_completed} of {golf_data.holes_played} holes
                              {scores.scores_confirmed === false && !isCurrentUser && (
                                <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">
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
                              className="text-sm font-bold text-brand-fg hover:text-brand-fg-strong px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-800 hover:bg-brand-soft transition-colors flex-shrink-0"
                            >
                              Edit
                            </button>
                          )}

                          {/* Score — stableford leads with points, others with
                              strokes. shrink-0: with the medal in the row a
                              long wrapped name must never squeeze the score. */}
                          <div className="text-right shrink-0">
                            {gameFormat === 'stableford' ? (
                              <>
                                <div className="text-3xl font-black text-primary">
                                  {stablefordPointsFor(scores.hole_scores)}
                                  <span className="text-sm font-bold text-muted ml-1">pts</span>
                                </div>
                                <div className="text-sm font-bold text-tertiary">{scores.total_score} strokes</div>
                              </>
                            ) : (
                              <>
                                <div className="text-3xl font-black text-primary">{scores.total_score}</div>
                                {/* SEMANTIC COLOUR — DO NOT NEUTRALISE: under/over par. */}
                                {scores.to_par !== null && (
                                  <div className={`text-sm font-bold ${scores.to_par < 0 ? 'text-green-600 dark:text-green-400' : scores.to_par > 0 ? 'text-red-600 dark:text-red-400' : 'text-tertiary'}`}>
                                    {scores.to_par >= 0 ? '+' : ''}{scores.to_par}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                  });
                  })()}

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
                        <div key={participant.id} className="flex items-center gap-4 p-4 bg-surface-muted">
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
                            <div className="w-12 h-12 rounded-full bg-gray-300 dark:bg-stone-700 flex items-center justify-center flex-shrink-0">
                              <span className="text-tertiary text-sm font-bold">
                                {getInitials(displayName)}
                              </span>
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            <div className={`font-bold text-base ${isCurrentUser ? 'text-brand-fg-strong' : 'text-tertiary'}`}>
                              {displayName}
                              {isCurrentUser && <span className="ml-2 text-sm inline-block">(You)</span>}
                            </div>
                            <div className="text-sm text-muted italic">
                              {isCurrentUser && onAddScores ? 'Tap to add your scores' : 'Awaiting scores'}
                            </div>
                          </div>

                          {isCreator && !isCurrentUser && onAddScores && (
                            <button
                              onClick={() => onAddScores(participant.id)}
                              className="text-sm font-bold text-brand-fg hover:text-brand-fg-strong px-3 py-2 rounded-lg border border-violet-200 dark:border-violet-800 hover:bg-brand-soft transition-colors flex-shrink-0"
                            >
                              Add scores
                            </button>
                          )}

                          {isCurrentUser && onAddScores && (
                            <button
                              onClick={() => onAddScores(participant.id)}
                              className="bg-brand hover:bg-brand-hover text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors"
                            >
                              Add Scores
                            </button>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* COURSE DETAILS — collapsed by default. Reference material,
                  not the round's content, so it sits last and folded; opening
                  it reveals the club info and, one tap further, the GPS map.
                  The Round Details grid lives INSIDE it: it is the same class
                  of information, and leaving one metadata card dangling under
                  the leaderboard would defeat the collapse.

                  <details> is state-backed on purpose, exactly as
                  GolfRoundCard documents it: this modal re-renders on every
                  refetch (onStatusChange/onMediaChanged) and PostCard
                  re-renders on every like, either of which would re-assert an
                  uncontrolled `open` and snap a user-closed section back
                  open. onToggle is an event handler, so no set-state-in-effect. */}
              <details
                className="group bg-surface rounded-lg border-2 border-border-strong"
                open={courseOpen}
                onToggle={e => setCourseOpen(e.currentTarget.open)}
              >
                <summary className="flex cursor-pointer items-center gap-2 px-4 min-h-[44px] text-lg font-black text-primary">
                  <i className="fas fa-chevron-right group-open:rotate-90 transition-transform text-sm" aria-hidden="true"></i>
                  Course details
                </summary>
                <div className="px-4 pb-4 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs font-semibold text-tertiary mb-1">Course</div>
                      <div className="font-bold text-primary">{golf_data.course_name}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-tertiary mb-1">Date</div>
                      <div className="font-bold text-primary">{formattedDate}</div>
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-tertiary mb-1">Holes</div>
                      <div className="font-bold text-primary">{holeCountValue(holesActuallyPlayed, golf_data.holes_played)}</div>
                    </div>
                    {golf_data.tee_color && (
                      <div>
                        <div className="text-xs font-semibold text-tertiary mb-1">Tees</div>
                        <div className="font-bold text-primary">{golf_data.tee_color.charAt(0).toUpperCase() + golf_data.tee_color.slice(1)}</div>
                      </div>
                    )}
                  </div>
                  {/* MOUNTED ONLY WHILE OPEN — do not "simplify" this to an
                      unconditional render. A closed <details> still MOUNTS its
                      children in React (the UA only display:none's them), so an
                      always-mounted card would fire the hole-geometry fetch and
                      instantiate Leaflet on every modal open — and a Leaflet map
                      built at display:none sizes itself to 0x0. Gating the mount
                      keeps `defaultOpen`, so the GPS map is one tap from here
                      rather than two. Catalog-linked rounds only: older/custom
                      rounds have no course row, and the grid above is then the
                      whole section (never an expander that opens onto nothing). */}
                  {courseOpen && (() => {
                    const info = embeddedCourseToInfo(golf_data.course);
                    return info ? <CourseInfoCard course={info} defaultOpen /> : null;
                  })()}
                </div>
              </details>
            </div>
          )}

          {/* Scorecard Tab */}
          {activeTab === 'scorecard' && (
            <div id="round-panel-scorecard" role="tabpanel" aria-labelledby="round-tab-scorecard">
              {front9.length > 0 && renderScorecardTable(front9, front9.length === 9 ? 'Front 9' : 'Holes')}
              {back9.length > 0 && renderScorecardTable(back9, 'Back 9')}

              {/* Total Score Summary */}
              {front9.length > 0 && back9.length > 0 && (
                <div className="bg-violet-100 dark:bg-violet-950/60 border-2 border-violet-300 dark:border-violet-700 rounded-lg p-4 mb-4">
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
                            <div className="font-bold text-sm text-violet-900 dark:text-violet-200 mb-1">{displayName}</div>
                            <div className="text-3xl font-black text-violet-900 dark:text-violet-200">{scores.total_score}</div>
                            {scores.to_par !== null && (
                              <div className={`text-sm font-bold ${scores.to_par < 0 ? 'text-green-600 dark:text-green-400' : scores.to_par > 0 ? 'text-red-600 dark:text-red-400' : 'text-tertiary'}`}>
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
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-tertiary mb-4">
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded ring-2 ring-violet-500 ring-inset bg-surface"></div>
                  <span>Eagle (-2)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded ring-1 ring-violet-400 ring-inset bg-surface"></div>
                  <span>Birdie (-1)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded border border-red-400 dark:border-red-500 bg-surface"></div>
                  <span>Bogey (+1)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded ring-2 ring-red-500 ring-inset bg-surface"></div>
                  <span>Double+ (+2)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="relative w-5 h-5 rounded border border-border bg-surface">
                    <span className="absolute -top-1 -right-1 text-[10px] text-amber-600 dark:text-amber-400 font-bold">2</span>
                  </div>
                  <span>Penalty count (hover a score for the breakdown)</span>
                </div>
              </div>
            </div>
          )}

          {/* Media Tab — everything, grouped by the moment it happened in. */}
          {activeTab === 'media' && (
            <div id="round-panel-media" role="tabpanel" aria-labelledby="round-tab-media">
              {/* Adding is allowed AFTER the round too — a photo you took on
                  the course but never got round to attaching still knows its
                  moment, because inferSegment suggests one from its capture
                  time. Live capture remains the exact path. */}
              {canManageMedia && (
                <RoundMediaManager
                  groupPostId={group_post.id}
                  sportKey="golf"
                  holeScores={currentUserParticipant?.scores.hole_scores}
                  onChanged={() => onMediaChanged?.()}
                />
              )}

              {roundMediaItems.length === 0 ? (
                <div className="py-12 text-center text-muted">
                  <i className="fas fa-images text-4xl text-gray-300 mb-3 block" aria-hidden="true"></i>
                  <p className="font-semibold text-secondary">No photos or videos yet</p>
                  <p className="mt-1 text-sm">
                    Photos added while scoring are tagged to the hole automatically.
                  </p>
                </div>
              ) : (
                mediaBySegment.map(([segment, group]) => (
                  <div key={segment ?? 'round'} className="mb-5">
                    {/* The ONLY sport-specific thing here is the word, and it
                        comes from the schema — an innings heading is this same
                        code with a different label. */}
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">
                      {segmentLabel('golf', segment)}
                    </div>
                    <MediaGrid
                      items={group}
                      onSelect={i =>
                        setLightboxIndex(roundMediaItems.findIndex(m => m.id === group[i].id))
                      }
                    />
                    {canManageMedia && (
                      // 2-up below sm: three ~80px columns left the segment
                      // select ~16px wide next to its two buttons
                      <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {group.map(item => (
                          <RoundMediaItemControls
                            key={item.id}
                            groupPostId={group_post.id}
                            mediaId={item.id}
                            sportKey="golf"
                            segment={item.segment ?? null}
                            isHighlight={!!item.isHighlight}
                            onChanged={() => onMediaChanged?.()}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
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
          <div className="shrink-0 border-t border-border-strong p-4 bg-surface-muted safe-bottom">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm text-secondary">
                {!currentUserParticipant!.scores.total_score && (
                  <span className="font-bold text-primary">You haven&apos;t added your scores yet</span>
                )}
              </div>
              <button
                onClick={() => onAddScores!(currentUserParticipant!.participant.id)}
                className="shrink-0 bg-brand hover:bg-brand-hover text-white font-bold py-2 px-4 rounded-lg transition-colors"
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
        confirmButtonClass="bg-brand hover:bg-brand-hover"
        onConfirm={handleEndRound}
        onCancel={() => setShowEndConfirm(false)}
      />

      {/* Delete Round confirmation */}
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
