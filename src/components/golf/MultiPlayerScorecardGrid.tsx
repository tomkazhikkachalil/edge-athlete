'use client';

import { useState, useCallback } from 'react';
import LazyImage from '@/components/LazyImage';
import { getInitials, formatDisplayName } from '@/lib/formatters';

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

export default function MultiPlayerScorecardGrid({
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

  // Get par for a specific hole
  const getHolePar = useCallback((holeNum: number): number => {
    if (holeData) {
      const hole = holeData.find(h => h.hole === holeNum);
      if (hole) return hole.par;
    }
    return 4; // Default to par 4 if no hole data
  }, [holeData]);

  // Calculate totals for a player
  const calculateTotals = useCallback((player: PlayerScoreData) => {
    const scored = player.hole_scores.filter(h => h.strokes !== undefined && h.strokes > 0);
    if (scored.length === 0) return {
      front9: 0,
      back9: 0,
      total: 0,
      toPar: 0,
      eagles: 0,
      birdies: 0,
      pars: 0,
      bogeys: 0,
      doublePlus: 0
    };

    const front9 = scored
      .filter(h => h.hole_number <= 9)
      .reduce((sum, h) => sum + (h.strokes || 0), 0);

    const back9 = scored
      .filter(h => h.hole_number > 9)
      .reduce((sum, h) => sum + (h.strokes || 0), 0);

    const total = front9 + back9;

    // Calculate actual par based on completed holes
    const actualPar = scored.reduce((sum, hole) => sum + getHolePar(hole.hole_number), 0);
    const toPar = total - actualPar;

    // Calculate score type counts
    let eagles = 0, birdies = 0, pars = 0, bogeys = 0, doublePlus = 0;
    scored.forEach(hole => {
      const holePar = getHolePar(hole.hole_number);
      const diff = (hole.strokes || 0) - holePar;
      if (diff <= -2) eagles++;
      else if (diff === -1) birdies++;
      else if (diff === 0) pars++;
      else if (diff === 1) bogeys++;
      else if (diff >= 2) doublePlus++;
    });

    return { front9, back9, total, toPar, eagles, birdies, pars, bogeys, doublePlus };
  }, [getHolePar]);

  // Get score style (birdie, par, bogey, etc.)
  const getScoreStyle = (strokes: number | undefined, holePar: number = 4) => {
    if (!strokes) return '';

    const diff = strokes - holePar;

    if (diff <= -2) return 'bg-blue-100 text-blue-800 font-bold border-2 border-blue-400 rounded-full'; // Eagle or better
    if (diff === -1) return 'bg-blue-50 text-blue-700 font-semibold border-2 border-blue-300 rounded-full'; // Birdie
    if (diff === 0) return 'text-gray-900'; // Par
    if (diff === 1) return 'bg-red-50 text-red-700 font-semibold border-2 border-red-300'; // Bogey
    if (diff >= 2) return 'bg-red-100 text-red-800 font-bold border-2 border-red-400'; // Double bogey+

    return '';
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

  const holePar = 4; // Default par for each hole

  return (
    <div className="w-full overflow-x-auto">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-bold text-gray-900">Scorecard</h3>
        <div className="flex items-center gap-3">
          {/* Front 9 / Back 9 Tabs (only for 18-hole rounds) */}
          {is18Holes && (
            <div className="flex border border-gray-300 rounded-lg overflow-hidden">
              <button
                onClick={() => setActiveTab('front9')}
                className={`px-4 py-1.5 text-sm font-semibold transition-colors ${
                  activeTab === 'front9'
                    ? 'bg-green-600 text-white'
                    : 'bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                Front 9
              </button>
              <button
                onClick={() => setActiveTab('back9')}
                className={`px-4 py-1.5 text-sm font-semibold transition-colors border-l border-gray-300 ${
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
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            {showStats ? 'Hide' : 'Show'} Detailed Stats
          </button>
        </div>
      </div>

      {/* Scorecard Table */}
      <div className="border border-gray-300 rounded-lg overflow-hidden">
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
              <tr className="bg-blue-50 border-t border-gray-300">
                <th className="sticky left-0 z-10 bg-blue-50 px-4 py-2 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider border-r border-gray-300">
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
                  <th className="px-4 py-2 text-center text-sm font-semibold text-gray-900 bg-blue-100 border-l border-gray-400">
                    {displayHoles.reduce((sum, h) => sum + getHolePar(h), 0)}
                  </th>
                )}
                <th className="px-4 py-2 text-center text-sm font-semibold text-gray-900 bg-blue-100">
                  {holeData.reduce((sum, h) => sum + h.par, 0)}
                </th>
                <th className="px-4 py-2 bg-blue-100"></th>
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
                          className="w-8 h-8 rounded-full object-cover"
                          width={32}
                          height={32}
                        />
                      ) : (
                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                          <span className="text-white text-xs font-semibold">
                            {getInitials(formatDisplayName(player.profile.first_name, null, player.profile.last_name, player.profile.full_name))}
                          </span>
                        </div>
                      )}
                      <span className="text-sm font-medium text-gray-900">
                        {formatDisplayName(player.profile.first_name, null, player.profile.last_name, player.profile.full_name)}
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
                            className={`w-12 h-10 text-center text-sm border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500 ${getScoreStyle(strokes, holePar)}`}
                            placeholder="-"
                          />
                        ) : (
                          <div className={`w-12 h-10 mx-auto flex items-center justify-center text-sm ${getScoreStyle(strokes, holePar)}`}>
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
                                    className="w-3 h-3 text-green-600 rounded"
                                  />
                                  <span className="text-gray-600">F</span>
                                </label>
                                <label className="flex items-center gap-0.5 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={holeScore?.green_in_regulation || false}
                                    onChange={(e) => handleScoreChange(player.participant_id, holeNum, 'green_in_regulation', e.target.checked)}
                                    className="w-3 h-3 text-green-600 rounded"
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
                        {totals.eagles > 0 && <span className="text-blue-700 font-semibold">{totals.eagles}E</span>}
                        {totals.eagles > 0 && (totals.birdies > 0 || totals.pars > 0 || totals.bogeys > 0 || totals.doublePlus > 0) && '•'}
                        {totals.birdies > 0 && <span className="text-blue-600">{totals.birdies}B</span>}
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
                    totals.toPar < 0 ? 'text-blue-600' : totals.toPar > 0 ? 'text-red-600' : 'text-gray-900'
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
      <div className="mt-4 flex items-center gap-4 text-xs text-gray-600">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-50 border-2 border-blue-300 rounded-full"></div>
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
          <div className="w-6 h-6 bg-blue-100 border-2 border-blue-400 rounded-full"></div>
          <span>Eagle</span>
        </div>
        {showStats && (
          <>
            <div className="flex items-center gap-1 ml-4">
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
