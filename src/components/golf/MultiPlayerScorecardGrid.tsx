'use client';

import { useState, useCallback, memo } from 'react';
import LazyImage from '@/components/LazyImage';
import { getInitials, formatDisplayName, formatShortName } from '@/lib/formatters';
import { holePar, classifyScore, calcPlayerTotals, SCORE_CELL_FILL } from '@/lib/golf/scoring';

export interface PlayerHoleScore {
  hole_number: number;
  strokes?: number;
  putts?: number;
  fairway_hit?: boolean;
  green_in_regulation?: boolean;
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
}

function MultiPlayerScorecardGrid({
  players,
  holes,
  coursePar: _coursePar = holes * 4, // eslint-disable-line @typescript-eslint/no-unused-vars -- Default par 4 per hole
  editable,
  showDetailedStats = false,
  onScoreChange,
  holeData
}: MultiPlayerScorecardGridProps) {
  const [showStats, setShowStats] = useState(showDetailedStats);
  const [activeTab, setActiveTab] = useState<'front9' | 'back9'>('front9');

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

  // Generate hole numbers array
  const allHoleNumbers = Array.from({ length: holes }, (_, i) => i + 1);
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
        <h3 className="text-lg font-bold text-gray-900">Scorecard</h3>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Front 9 / Back 9 Tabs (only for 18-hole rounds) */}
          {is18Holes && (
            <div className="flex border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setActiveTab('front9')}
                className={`px-4 py-2 min-h-[36px] text-sm font-semibold transition-colors ${
                  activeTab === 'front9'
                    ? 'bg-green-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Front 9
              </button>
              <button
                onClick={() => setActiveTab('back9')}
                className={`px-4 py-2 min-h-[36px] text-sm font-semibold transition-colors border-l border-gray-300 ${
                  activeTab === 'back9'
                    ? 'bg-green-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Back 9
              </button>
            </div>
          )}
          <button
            onClick={() => setShowStats(!showStats)}
            className="text-sm text-violet-600 hover:text-violet-700 font-medium py-2 px-2 -mx-2"
          >
            {showStats ? 'Hide' : 'Show'} Detailed Stats
          </button>
        </div>
      </div>

      {/* Scorecard Table — only the table scrolls horizontally */}
      <div className="border border-gray-300 rounded-lg overflow-hidden overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-300">
          <thead className="bg-green-50">
            <tr>
              <th className="sticky left-0 z-10 bg-green-50 px-4 py-3 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider border-r border-gray-300">
                Player
              </th>
              {displayHoles.map(holeNum => (
                <th
                  key={holeNum}
                  className="px-3 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wider border-r border-gray-200"
                >
                  {holeNum}
                </th>
              ))}
              {is18Holes && (
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wider bg-gray-100 border-l border-gray-400">
                  {activeTab === 'front9' ? 'Out' : 'In'}
                </th>
              )}
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wider bg-gray-100">
                Total
              </th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wider bg-gray-100">
                +/-
              </th>
            </tr>

            {/* Par Row */}
            {holeData && holeData.length > 0 && (
              <tr className="bg-violet-50 border-t border-gray-300">
                <th className="sticky left-0 z-10 bg-violet-50 px-4 py-2 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider border-r border-gray-300">
                  Par
                </th>
                {displayHoles.map(holeNum => (
                  <th
                    key={holeNum}
                    className="px-3 py-2 text-center text-sm font-semibold text-gray-900 border-r border-gray-200"
                  >
                    {getHolePar(holeNum)}
                  </th>
                ))}
                {is18Holes && (
                  <th className="px-4 py-2 text-center text-sm font-semibold text-gray-900 bg-violet-100 border-l border-gray-400">
                    {displayHoles.reduce((sum, h) => sum + getHolePar(h), 0)}
                  </th>
                )}
                <th className="px-4 py-2 text-center text-sm font-semibold text-gray-900 bg-violet-100">
                  {holeData.reduce((sum, h) => sum + h.par, 0)}
                </th>
                <th className="px-4 py-2 bg-violet-100"></th>
              </tr>
            )}

            {/* Yardage Row */}
            {holeData && holeData.some(h => h.yardage) && (
              <tr className="bg-gray-100 border-t border-gray-300">
                <th className="sticky left-0 z-10 bg-gray-100 px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider border-r border-gray-300">
                  Yardage
                </th>
                {displayHoles.map(holeNum => {
                  const hole = holeData.find(h => h.hole === holeNum);
                  return (
                    <th
                      key={holeNum}
                      className="px-3 py-2 text-center text-xs text-gray-700 border-r border-gray-200"
                    >
                      {hole?.yardage || '-'}
                    </th>
                  );
                })}
                {is18Holes && (
                  <th className="px-4 py-2 text-center text-xs text-gray-700 bg-gray-200 border-l border-gray-400">
                    {displayHoles.reduce((sum, h) => {
                      const hole = holeData.find(hd => hd.hole === h);
                      return sum + (hole?.yardage || 0);
                    }, 0)}
                  </th>
                )}
                <th className="px-4 py-2 text-center text-xs text-gray-700 bg-gray-200">
                  {holeData.reduce((sum, h) => sum + (h.yardage || 0), 0)}
                </th>
                <th className="px-4 py-2 bg-gray-200"></th>
              </tr>
            )}
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {players.map((player) => {
              const totals = calculateTotals(player);

              return (
                <tr key={player.participant_id} className="hover:bg-gray-50">
                  {/* Player Name Column */}
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 whitespace-nowrap border-r border-gray-300">
                    <div className="flex items-center gap-2">
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
                      <span
                        className="text-sm font-medium text-gray-900 max-w-[140px] truncate"
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
                        className="px-2 py-2 text-center border-r border-gray-200"
                      >
                        {editable ? (
                          <input
                            type="number"
                            min="1"
                            max="15"
                            value={strokes || ''}
                            onChange={(e) => handleScoreChange(player.participant_id, holeNum, 'strokes', e.target.value)}
                            className={`w-12 h-10 text-center text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500 ${getScoreStyle(strokes, getHolePar(holeNum))}`}
                            placeholder="-"
                          />
                        ) : (
                          <div className={`w-12 h-10 mx-auto flex items-center justify-center text-sm ${getScoreStyle(strokes, getHolePar(holeNum))}`}>
                            {strokes || '-'}
                          </div>
                        )}

                        {/* Detailed Stats (if enabled) */}
                        {showStats && holeNum !== 3 && ( // Par 3s don't have fairways
                          <div className="mt-1 flex items-center justify-center gap-1 text-xs">
                            {editable ? (
                              <>
                                <label className="flex items-center gap-0.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={holeScore?.fairway_hit || false}
                                    onChange={(e) => handleScoreChange(player.participant_id, holeNum, 'fairway_hit', e.target.checked)}
                                    className="w-4 h-4 text-green-600 rounded"
                                  />
                                  <span className="text-gray-600">F</span>
                                </label>
                                <label className="flex items-center gap-0.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={holeScore?.green_in_regulation || false}
                                    onChange={(e) => handleScoreChange(player.participant_id, holeNum, 'green_in_regulation', e.target.checked)}
                                    className="w-4 h-4 text-green-600 rounded"
                                  />
                                  <span className="text-gray-600">G</span>
                                </label>
                              </>
                            ) : (
                              <>
                                {holeScore?.fairway_hit && <span className="text-green-600">F</span>}
                                {holeScore?.green_in_regulation && <span className="text-green-600">G</span>}
                              </>
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
                                className="w-12 h-6 text-center text-xs border border-gray-200 rounded focus:ring-1 focus:ring-green-400"
                                placeholder="P"
                              />
                            ) : (
                              <div className="text-xs text-gray-600">
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
                    <td className="px-4 py-3 text-center text-sm font-semibold text-gray-900 bg-gray-50 border-l border-gray-400">
                      {activeTab === 'front9' ? (totals.front9 || '-') : (totals.back9 || '-')}
                    </td>
                  )}
                  <td className="px-4 py-3 text-center bg-gray-50">
                    <div className="text-sm font-bold text-gray-900">
                      {totals.total || '-'}
                    </div>
                    {totals.total > 0 && (
                      <div className="text-xs text-gray-600 mt-0.5">
                        {totals.eagles > 0 && <span className="text-violet-700 font-semibold">{totals.eagles}E</span>}
                        {totals.eagles > 0 && (totals.birdies > 0 || totals.pars > 0 || totals.bogeys > 0 || totals.doublePlus > 0) && '•'}
                        {totals.birdies > 0 && <span className="text-violet-600">{totals.birdies}B</span>}
                        {totals.birdies > 0 && (totals.pars > 0 || totals.bogeys > 0 || totals.doublePlus > 0) && '•'}
                        {totals.pars > 0 && <span className="text-gray-700">{totals.pars}P</span>}
                        {totals.pars > 0 && (totals.bogeys > 0 || totals.doublePlus > 0) && '•'}
                        {totals.bogeys > 0 && <span className="text-red-600">{totals.bogeys}Bo</span>}
                        {totals.bogeys > 0 && totals.doublePlus > 0 && '•'}
                        {totals.doublePlus > 0 && <span className="text-red-700 font-semibold">{totals.doublePlus}D+</span>}
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-3 text-center text-sm font-bold bg-gray-50 ${
                    totals.toPar < 0 ? 'text-violet-600' : totals.toPar > 0 ? 'text-red-600' : 'text-gray-900'
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
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-violet-50 border-2 border-violet-300 rounded-full"></div>
          <span>Birdie</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 border border-gray-300"></div>
          <span>Par</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-red-50 border-2 border-red-300"></div>
          <span>Bogey</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-violet-100 border-2 border-violet-400 rounded-full"></div>
          <span>Eagle</span>
        </div>
        {showStats && (
          <>
            <div className="flex items-center gap-1">
              <span className="text-green-600 font-semibold">F</span>
              <span>= Fairway Hit</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-green-600 font-semibold">G</span>
              <span>= Green in Regulation</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Memoized: the grid re-rendered on every keystroke of the parent modal
// (2000+ line component) even when its own props hadn't changed.
export default memo(MultiPlayerScorecardGrid);
