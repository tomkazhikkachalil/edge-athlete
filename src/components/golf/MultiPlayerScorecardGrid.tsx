'use client';

import { useState, useCallback, memo } from 'react';
import LazyImage from '@/components/LazyImage';
import ScoreEntryModal from '@/components/golf/ScoreEntryModal';
import { getInitials, formatDisplayName, formatShortName } from '@/lib/formatters';
import { totalPenalties } from '@/lib/golf/penalties';
import { holePar, classifyScore, calcPlayerTotals, SCORE_CELL_FILL } from '@/lib/golf/scoring';
import type { GolfHoleScore } from '@/types/group-posts';

export interface PlayerHoleScore {
  hole_number: number;
  strokes?: number;
  putts?: number;
  fairway_hit?: boolean;
  green_in_regulation?: boolean;
  /** One element per occurrence — vocabulary in @/lib/golf/penalties (migration 078). */
  penalties?: string[] | null;
}

export interface PlayerScoreData {
  participant_id: string;
  profile: {
    id: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
    avatar_url?: string;
  };
  hole_scores: PlayerHoleScore[];
  total_score?: number;
  to_par?: number;
}

interface MultiPlayerScorecardGridProps {
  players: PlayerScoreData[];
  holes: number; // 9 or 18
  coursePar?: number; // Total par for the course
  editable: boolean; // Can scores be edited?
  showDetailedStats?: boolean; // Show FIR, GIR, putts columns
  onScoreChange?: (playerId: string, holeNum: number, data: Partial<PlayerHoleScore>) => void;
  holeData?: { hole: number; par: number; yardage?: number }[]; // Par and yardage per hole
  /** First hole number (10 for back-9 solo rounds). Defaults to 1. */
  startingHoleNumber?: number;
  /** Course name forwarded to the quick-entry stepper's context line. */
  courseName?: string | null;
  /** Increment to open the quick-entry stepper in resume mode for the first
   *  player — the seam the solo form's header "Quick entry" button uses.
   *  Requires editable + onScoreChange. */
  quickEntryRequest?: number;
}

function MultiPlayerScorecardGrid({
  players,
  holes,
  coursePar: _coursePar = holes * 4, // eslint-disable-line @typescript-eslint/no-unused-vars -- Default par 4 per hole
  editable,
  showDetailedStats = false,
  onScoreChange,
  holeData,
  startingHoleNumber = 1,
  courseName = null,
  quickEntryRequest = 0
}: MultiPlayerScorecardGridProps) {
  const [showStats, setShowStats] = useState(showDetailedStats);
  const [activeTab, setActiveTab] = useState<'front9' | 'back9'>('front9');

  // Quick-entry stepper session: which player's card is open, at which hole
  // (null = the modal's own first-incomplete-hole resume logic), and whether
  // a penalty badge asked for the Penalties block to be scrolled into view.
  const [entrySession, setEntrySession] = useState<{
    playerId: string;
    hole: number | null;
    focusPenalties: boolean;
  } | null>(null);

  // The solo form's header "Quick entry" button lifts its request in via a
  // counter prop; render-phase sync (repo convention — see GolfScorecardForm)
  // so the modal mounts on the same paint. Seeded with the current value, so
  // nothing opens on mount.
  const [seenQuickEntryRequest, setSeenQuickEntryRequest] = useState(quickEntryRequest);
  if (quickEntryRequest !== seenQuickEntryRequest) {
    setSeenQuickEntryRequest(quickEntryRequest);
    if (editable && onScoreChange && players.length > 0) {
      setEntrySession({ playerId: players[0].participant_id, hole: null, focusPenalties: false });
    }
  }

  // Par lookup — shared domain logic (lib/golf/scoring)
  const getHolePar = useCallback(
    (holeNum: number): number => holePar(holeNum, holeData),
    [holeData]
  );

  // Totals — shared domain logic (lib/golf/scoring)
  const calculateTotals = useCallback(
    (player: PlayerScoreData) => calcPlayerTotals(player.hole_scores, holeData),
    [holeData]
  );

  // Cell style — shared classification (lib/golf/scoring)
  const getScoreStyle = (strokes: number | undefined, par: number = 4) => {
    const cls = classifyScore(strokes, par);
    return cls ? SCORE_CELL_FILL[cls] : '';
  };

  // Handle score input change
  const handleScoreChange = (playerId: string, holeNum: number, field: keyof PlayerHoleScore, value: string | boolean) => {
    if (!onScoreChange || !editable) return;

    const parsedValue = typeof value === 'boolean'
      ? value
      : field === 'strokes' || field === 'putts'
        ? parseInt(value) || undefined
        : value;

    onScoreChange(playerId, holeNum, { [field]: parsedValue });
  };

  // Generate hole numbers array (back-9 solo rounds start at 10)
  const allHoleNumbers = Array.from({ length: holes }, (_, i) => startingHoleNumber + i);
  const front9Holes = allHoleNumbers.filter(h => h <= 9);
  const back9Holes = allHoleNumbers.filter(h => h > 9);
  const is18Holes = holes === 18;

  // Determine which holes to display based on tab
  const displayHoles = is18Holes
    ? (activeTab === 'front9' ? front9Holes : back9Holes)
    : allHoleNumbers;

  return (
    <div className="w-full">
      {/* Header lives OUTSIDE the horizontal scroll container — inside it,
          justify-between stretches to the table's scroll-width and the
          controls end up off-screen on phones. flex-wrap for 360px. */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-lg font-bold text-primary">Scorecard</h3>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Front 9 / Back 9 Tabs (only for 18-hole rounds) */}
          {is18Holes && (
            <div className="flex border border-border-strong rounded-lg overflow-hidden">
              <button
                onClick={() => setActiveTab('front9')}
                className={`px-4 py-2 min-h-[44px] text-sm font-semibold transition-colors ${
                  activeTab === 'front9'
                    ? 'bg-green-600 text-white'
                    : 'bg-surface text-secondary hover:bg-surface-muted'
                }`}
              >
                Front 9
              </button>
              <button
                onClick={() => setActiveTab('back9')}
                className={`px-4 py-2 min-h-[44px] text-sm font-semibold transition-colors border-l border-border-strong ${
                  activeTab === 'back9'
                    ? 'bg-green-600 text-white'
                    : 'bg-surface text-secondary hover:bg-surface-muted'
                }`}
              >
                Back 9
              </button>
            </div>
          )}
          <button
            onClick={() => setShowStats(!showStats)}
            className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium py-2 px-2 -mx-2"
          >
            {showStats ? 'Hide' : 'Show'} Detailed Stats
          </button>
        </div>
      </div>

      {/* Scorecard Table — only the table scrolls horizontally. Just
          overflow-x-auto: the old `overflow-hidden overflow-x-auto` pair left
          overflow-y hidden, silently clipping the stats rows when they grow. */}
      <div className="border border-border-strong rounded-lg overflow-x-auto">
        <table className="min-w-full divide-y divide-border-strong">
          <thead className="bg-green-50 dark:bg-green-950/40">
            <tr>
              <th className="sticky left-0 z-10 bg-green-50 dark:bg-green-950/40 px-2 sm:px-4 py-3 text-left text-xs font-semibold text-primary uppercase tracking-wider border-r border-border-strong">
                Player
              </th>
              {displayHoles.map(holeNum => (
                <th
                  key={holeNum}
                  className="px-3 py-3 text-center text-xs font-semibold text-primary uppercase tracking-wider border-r border-border"
                >
                  {holeNum}
                </th>
              ))}
              {is18Holes && (
                <th className="px-4 py-3 text-center text-xs font-semibold text-primary uppercase tracking-wider bg-surface-sunken border-l border-border-strong">
                  {activeTab === 'front9' ? 'Out' : 'In'}
                </th>
              )}
              <th className="px-4 py-3 text-center text-xs font-semibold text-primary uppercase tracking-wider bg-surface-sunken">
                Total
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-primary uppercase tracking-wider bg-surface-sunken">
                +/-
              </th>
            </tr>

            {/* Par Row */}
            {holeData && holeData.length > 0 && (
              <tr className="bg-brand-soft border-t border-border-strong">
                <th className="sticky left-0 z-10 bg-brand-soft px-2 sm:px-4 py-2 text-left text-xs font-semibold text-primary uppercase tracking-wider border-r border-border-strong">
                  Par
                </th>
                {displayHoles.map(holeNum => {
                  const par = getHolePar(holeNum);
                  return (
                    <th
                      key={holeNum}
                      // Par color-coding carried over from the solo scorecard:
                      // par 3 red, par 5 yellow, par 4 keeps the row's brand-soft
                      className={`px-3 py-2 text-center text-sm font-semibold text-primary border-r border-border ${
                        par === 3
                          ? 'bg-red-100 dark:bg-red-950/60'
                          : par === 5
                            ? 'bg-yellow-100 dark:bg-yellow-950/60'
                            : ''
                      }`}
                    >
                      {par}
                    </th>
                  );
                })}
                {is18Holes && (
                  <th className="px-4 py-2 text-center text-sm font-semibold text-primary bg-violet-100 dark:bg-violet-950/60 border-l border-border-strong">
                    {displayHoles.reduce((sum, h) => sum + getHolePar(h), 0)}
                  </th>
                )}
                <th className="px-4 py-2 text-center text-sm font-semibold text-primary bg-violet-100 dark:bg-violet-950/60">
                  {holeData.reduce((sum, h) => sum + h.par, 0)}
                </th>
                <th className="px-4 py-2 bg-violet-100 dark:bg-violet-950/60"></th>
              </tr>
            )}

            {/* Yardage Row */}
            {holeData && holeData.some(h => h.yardage) && (
              <tr className="bg-surface-sunken border-t border-border-strong">
                <th className="sticky left-0 z-10 bg-surface-sunken px-2 sm:px-4 py-2 text-left text-xs font-semibold text-tertiary uppercase tracking-wider border-r border-border-strong">
                  Yardage
                </th>
                {displayHoles.map(holeNum => {
                  const hole = holeData.find(h => h.hole === holeNum);
                  return (
                    <th
                      key={holeNum}
                      className="px-3 py-2 text-center text-xs text-secondary border-r border-border"
                    >
                      {hole?.yardage || '-'}
                    </th>
                  );
                })}
                {is18Holes && (
                  <th className="px-4 py-2 text-center text-xs text-secondary bg-surface-sunken border-l border-border-strong">
                    {displayHoles.reduce((sum, h) => {
                      const hole = holeData.find(hd => hd.hole === h);
                      return sum + (hole?.yardage || 0);
                    }, 0)}
                  </th>
                )}
                <th className="px-4 py-2 text-center text-xs text-secondary bg-surface-sunken">
                  {holeData.reduce((sum, h) => sum + (h.yardage || 0), 0)}
                </th>
                <th className="px-4 py-2 bg-surface-sunken"></th>
              </tr>
            )}
          </thead>
          <tbody className="bg-surface divide-y divide-border">
            {players.map((player) => {
              const totals = calculateTotals(player);

              return (
                <tr key={player.participant_id} className="hover:bg-surface-muted">
                  {/* Player Name Column */}
                  {/* Narrow sticky column below sm: avatar + px-4 + a 140px
                      name was ~212px — wider than the whole scroll window
                      inside CreatePostModal at 320px, so ZERO hole columns
                      were visible. ~90px keeps ~4 hole columns on screen. */}
                  <td className="sticky left-0 z-10 bg-surface px-2 sm:px-4 py-3 whitespace-nowrap border-r border-border-strong">
                    <div className="flex items-center gap-2">
                      <span className="hidden sm:block shrink-0">
                        {player.profile.avatar_url ? (
                          <LazyImage
                            src={player.profile.avatar_url}
                            alt={formatDisplayName(player.profile.first_name, null, player.profile.last_name, player.profile.full_name)}
                            className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                            width={32}
                            height={32}
                          />
                        ) : (
                          <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-xs font-semibold">
                              {getInitials(formatDisplayName(player.profile.first_name, null, player.profile.last_name, player.profile.full_name))}
                            </span>
                          </div>
                        )}
                      </span>
                      <span
                        className="text-sm font-medium text-primary max-w-[72px] sm:max-w-[140px] truncate"
                        title={formatDisplayName(player.profile.first_name, null, player.profile.last_name, player.profile.full_name)}
                      >
                        {formatShortName(player.profile.first_name, player.profile.last_name, player.profile.full_name, 18)}
                      </span>
                    </div>
                  </td>

                  {/* Hole Score Columns */}
                  {displayHoles.map(holeNum => {
                    const holeScore = player.hole_scores.find(h => h.hole_number === holeNum);
                    const strokes = holeScore?.strokes;

                    return (
                      <td
                        key={holeNum}
                        className="px-2 py-2 text-center border-r border-border"
                      >
                        {editable ? (
                          <input
                            type="number"
                            min="1"
                            max="15"
                            value={strokes || ''}
                            onChange={(e) => handleScoreChange(player.participant_id, holeNum, 'strokes', e.target.value)}
                            className={`w-12 h-10 text-center text-sm border border-border-strong rounded ${getScoreStyle(strokes, getHolePar(holeNum))}`}
                            placeholder="-"
                          />
                        ) : (
                          <div className={`w-12 h-10 mx-auto flex items-center justify-center text-sm ${getScoreStyle(strokes, getHolePar(holeNum))}`}>
                            {strokes || '-'}
                          </div>
                        )}

                        {/* Detailed Stats (if enabled). Only the FAIRWAY stat
                            is par-gated (par 3s have no fairway — the solo
                            grid's • placeholder). GIR and penalties render for
                            EVERY hole: the old gate compared the HOLE NUMBER
                            to 3, hiding all three stats on every course's
                            hole 3 and showing a fairway on par-3s elsewhere. */}
                        {showStats && (
                          <div className="mt-1 flex items-center justify-center gap-1 text-xs">
                            {editable ? (
                              <>
                                {getHolePar(holeNum) !== 3 ? (
                                  <label className="flex items-center gap-0.5 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={holeScore?.fairway_hit || false}
                                      onChange={(e) => handleScoreChange(player.participant_id, holeNum, 'fairway_hit', e.target.checked)}
                                      className="w-5 h-5 text-green-600 dark:text-green-400 rounded"
                                    />
                                    <span className="text-tertiary">F</span>
                                  </label>
                                ) : (
                                  <span className="text-tertiary font-bold" aria-hidden="true">•</span>
                                )}
                                <label className="flex items-center gap-0.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={holeScore?.green_in_regulation || false}
                                    onChange={(e) => handleScoreChange(player.participant_id, holeNum, 'green_in_regulation', e.target.checked)}
                                    className="w-5 h-5 text-green-600 dark:text-green-400 rounded"
                                  />
                                  <span className="text-tertiary">G</span>
                                </label>
                              </>
                            ) : (
                              <>
                                {holeScore?.fairway_hit && getHolePar(holeNum) !== 3 && <span className="text-green-600 dark:text-green-400">F</span>}
                                {holeScore?.green_in_regulation && <span className="text-green-600 dark:text-green-400">G</span>}
                              </>
                            )}
                            {/* Penalties: entered via the quick-entry stepper
                                (dropdown + count — too much control for a grid
                                cell), so in editable mode the badge is a button
                                opening it at this hole with Penalties in view */}
                            {editable && onScoreChange ? (
                              <button
                                type="button"
                                onClick={() => setEntrySession({
                                  playerId: player.participant_id,
                                  hole: holeNum,
                                  focusPenalties: true,
                                })}
                                className={`min-w-[24px] px-1 py-0.5 rounded font-semibold transition-colors hover:bg-border ${
                                  totalPenalties(holeScore?.penalties) > 0
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-faint'
                                }`}
                                title={`Hole ${holeNum}: edit penalties in quick entry`}
                                aria-label={`Hole ${holeNum}: ${totalPenalties(holeScore?.penalties)} penalt${totalPenalties(holeScore?.penalties) === 1 ? 'y' : 'ies'} — edit in quick entry`}
                              >
                                {totalPenalties(holeScore?.penalties) > 0 ? `P${totalPenalties(holeScore?.penalties)}` : '−'}
                              </button>
                            ) : (
                              totalPenalties(holeScore?.penalties) > 0 && (
                                <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                  P{totalPenalties(holeScore?.penalties)}
                                </span>
                              )
                            )}
                          </div>
                        )}

                        {/* Putts (if detailed stats enabled) */}
                        {showStats && (
                          <div className="mt-1">
                            {editable ? (
                              <input
                                type="number"
                                min="0"
                                max="5"
                                value={holeScore?.putts || ''}
                                onChange={(e) => handleScoreChange(player.participant_id, holeNum, 'putts', e.target.value)}
                                className="w-12 h-6 text-center text-xs border border-border-strong rounded"
                                placeholder="P"
                              />
                            ) : (
                              <div className="text-xs text-tertiary">
                                {holeScore?.putts ? `${holeScore.putts}p` : ''}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  {/* Totals Columns */}
                  {is18Holes && (
                    <td className="px-4 py-3 text-center text-sm font-semibold text-primary bg-surface-muted border-l border-border-strong">
                      {activeTab === 'front9' ? (totals.front9 || '-') : (totals.back9 || '-')}
                    </td>
                  )}
                  <td className="px-4 py-3 text-center bg-surface-muted">
                    <div className="text-sm font-bold text-primary">
                      {totals.total || '-'}
                    </div>
                    {totals.total > 0 && (
                      <div className="text-xs text-tertiary mt-0.5">
                        {totals.eagles > 0 && <span className="text-brand-fg-strong font-semibold">{totals.eagles}E</span>}
                        {totals.eagles > 0 && (totals.birdies > 0 || totals.pars > 0 || totals.bogeys > 0 || totals.doublePlus > 0) && '•'}
                        {totals.birdies > 0 && <span className="text-brand-fg">{totals.birdies}B</span>}
                        {totals.birdies > 0 && (totals.pars > 0 || totals.bogeys > 0 || totals.doublePlus > 0) && '•'}
                        {totals.pars > 0 && <span className="text-secondary">{totals.pars}P</span>}
                        {totals.pars > 0 && (totals.bogeys > 0 || totals.doublePlus > 0) && '•'}
                        {totals.bogeys > 0 && <span className="text-red-600 dark:text-red-400">{totals.bogeys}Bo</span>}
                        {totals.bogeys > 0 && totals.doublePlus > 0 && '•'}
                        {totals.doublePlus > 0 && <span className="text-red-700 dark:text-red-300 font-semibold">{totals.doublePlus}D+</span>}
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-center text-sm font-bold bg-surface-muted ${
                    totals.toPar < 0 ? 'text-brand-fg' : totals.toPar > 0 ? 'text-red-600 dark:text-red-400' : 'text-primary'
                  }`}>
                    {totals.toPar > 0 ? `+${totals.toPar}` : totals.toPar || 'E'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-tertiary">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-brand-soft border-2 border-violet-300 dark:border-violet-700 rounded-full"></div>
          <span>Birdie</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 border border-border-strong"></div>
          <span>Par</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-red-50 dark:bg-red-950/40 border-2 border-red-300 dark:border-red-700"></div>
          <span>Bogey</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-violet-100 dark:bg-violet-950/60 border-2 border-violet-400 dark:border-violet-600 rounded-full"></div>
          <span>Eagle</span>
        </div>
        {showStats && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-green-600 dark:text-green-400 font-semibold">F</span>
              <span>= Fairway Hit</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-green-600 dark:text-green-400 font-semibold">G</span>
              <span>= Green in Regulation</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-amber-600 dark:text-amber-400 font-semibold">P</span>
              <span>= Penalties{editable ? ' (tap to edit)' : ''}</span>
            </div>
          </>
        )}
      </div>

      {/* ONE quick-entry stepper for the whole grid, keyed by player so a
          switch reseeds. Batch mode (no groupPostId): scores flow back through
          onScoreChange per hole — the same write path the cells use. */}
      {editable && onScoreChange && entrySession && (() => {
        const entryPlayer = players.find(p => p.participant_id === entrySession.playerId);
        if (!entryPlayer) return null;
        return (
          <ScoreEntryModal
            key={entrySession.playerId}
            groupPostId=""
            participantId={entrySession.playerId}
            holesPlayed={holes}
            startingHoleNumber={startingHoleNumber}
            holeData={holeData ?? null}
            courseName={courseName}
            playerName={players.length > 1
              ? formatDisplayName(entryPlayer.profile.first_name, null, entryPlayer.profile.last_name, entryPlayer.profile.full_name)
              : undefined}
            existingScores={entryPlayer.hole_scores.filter(s => typeof s.strokes === 'number') as unknown as GolfHoleScore[]}
            initialHole={entrySession.hole ?? undefined}
            focusSection={entrySession.focusPenalties ? 'penalties' : undefined}
            onSave={async (scores) => {
              // Callers update via functional setState, so per-hole patches
              // in one tick accumulate correctly.
              for (const s of scores) {
                onScoreChange(entrySession.playerId, s.hole_number, {
                  strokes: s.strokes,
                  putts: s.putts,
                  fairway_hit: s.fairway_hit,
                  green_in_regulation: s.green_in_regulation,
                  penalties: s.penalties ?? null,
                });
              }
            }}
            onClose={() => setEntrySession(null)}
          />
        );
      })()}
    </div>
  );
}

// Memoized: the grid re-rendered on every keystroke of the parent modal
// (2000+ line component) even when its own props hadn't changed.
export default memo(MultiPlayerScorecardGrid);
