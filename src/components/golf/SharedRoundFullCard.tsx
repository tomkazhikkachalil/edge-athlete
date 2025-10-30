'use client';

import { useState } from 'react';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import LazyImage from '../LazyImage';
import type { CompleteGolfScorecard } from '@/types/group-posts';

interface SharedRoundFullCardProps {
  scorecard: CompleteGolfScorecard;
  currentUserId?: string;
  onClose: () => void;
  onAddScores?: (participantId: string) => void;
}

export default function SharedRoundFullCard({
  scorecard,
  currentUserId,
  onClose,
  onAddScores
}: SharedRoundFullCardProps) {
  const { group_post, golf_data, participants } = scorecard;
  const [activeTab, setActiveTab] = useState<'overview' | 'scorecard'>('overview');

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

  // Calculate estimated par per hole (4 default)
  const estimatedPar = 4;

  // Find current user's participant record
  const currentUserParticipant = participants.find(
    p => p.participant.profile_id === currentUserId
  );

  const renderScorecardTable = (holeNumbers: number[], title: string) => {
    if (holeNumbers.length === 0) return null;

    const totalHoles = holeNumbers.length;

    return (
      <div className="mb-4">
        <div className="bg-white rounded-lg border-2 border-green-300 overflow-hidden">
          {/* Table Header */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-green-100 border-b-2 border-green-300">
                  <th className="text-left py-2 px-3 font-bold text-green-900 sticky left-0 bg-green-100 z-10 min-w-[120px]">
                    {title}
                  </th>
                  {holeNumbers.map(holeNum => (
                    <th key={holeNum} className="text-center py-2 px-2 font-black text-green-900 min-w-[40px]">
                      {holeNum}
                    </th>
                  ))}
                  <th className="text-center py-2 px-3 font-black text-green-900 bg-green-200 min-w-[50px]">
                    {title === 'Front 9' ? 'OUT' : title === 'Back 9' ? 'IN' : 'TOTAL'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {/* Par Row */}
                <tr className="border-b border-gray-300 bg-yellow-50">
                  <td className="py-2 px-3 font-bold text-gray-900 sticky left-0 bg-yellow-50 z-10">PAR</td>
                  {holeNumbers.map(holeNum => (
                    <td key={holeNum} className="text-center py-2 px-2 font-bold text-gray-900">
                      {estimatedPar}
                    </td>
                  ))}
                  <td className="text-center py-2 px-3 font-black text-gray-900 bg-yellow-100">
                    {totalHoles * estimatedPar}
                  </td>
                </tr>

                {/* Player Rows */}
                {participants
                  .filter(p => p.participant.status === 'confirmed')
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
                      <tr key={participant.id} className="border-b border-gray-200 hover:bg-green-50">
                        <td className="py-2 px-3 sticky left-0 bg-white z-10 hover:bg-green-50">
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
                            <span className={`font-bold text-gray-900 text-xs truncate ${isCurrentUser ? 'text-blue-600' : ''}`}>
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

                          const diff = hole.strokes - estimatedPar;
                          let textColor = 'text-gray-900 font-semibold';
                          let border = '';

                          if (diff === -2) { // Eagle
                            border = 'ring-2 ring-blue-500 ring-inset';
                            textColor = 'text-blue-600 font-black';
                          } else if (diff === -1) { // Birdie
                            border = 'ring-1 ring-blue-400 ring-inset';
                            textColor = 'text-blue-600 font-bold';
                          } else if (diff === 1) { // Bogey
                            border = 'border border-red-400';
                            textColor = 'text-red-600 font-semibold';
                          } else if (diff >= 2) { // Double+
                            border = 'ring-2 ring-red-500 ring-inset';
                            textColor = 'text-red-600 font-bold';
                          }

                          return (
                            <td key={holeNum} className="text-center py-2 px-1">
                              <div className={`${textColor} ${border} bg-white rounded mx-auto w-7 h-7 flex items-center justify-center text-sm`}>
                                {hole.strokes}
                              </div>
                            </td>
                          );
                        })}

                        <td className="text-center py-2 px-3 bg-blue-50">
                          <span className="font-black text-blue-900 text-base">
                            {subtotal || '-'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                {/* Pending/No Scores Rows */}
                {participants
                  .filter(p => p.participant.status === 'confirmed' && !p.scores.total_score)
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
                            <span className={`font-bold text-gray-600 text-xs truncate ${isCurrentUser ? 'text-blue-600' : ''}`}>
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
                              className="text-xs text-blue-600 hover:text-blue-800 font-bold"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h2 className="text-2xl font-black mb-2">{golf_data.course_name}</h2>
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
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-600 rounded-full text-xs">
                      <i className="fas fa-warehouse"></i>
                      INDOOR
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-800 rounded-full text-xs">
                      <i className="fas fa-tree"></i>
                      OUTDOOR
                    </span>
                  )}
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 text-2xl font-bold ml-4"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-gray-300 bg-white">
          <div className="flex px-6">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-6 py-3 font-bold text-sm border-b-2 transition-colors ${
                activeTab === 'overview'
                  ? 'border-green-600 text-green-700'
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
                  ? 'border-green-600 text-green-700'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <i className="fas fa-table mr-2"></i>
              Full Scorecard
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Leaderboard */}
              <div className="bg-white rounded-lg border-2 border-green-300 overflow-hidden">
                <div className="bg-green-100 px-4 py-3 border-b-2 border-green-300">
                  <h3 className="text-lg font-black text-green-900">
                    <i className="fas fa-trophy mr-2"></i>
                    Leaderboard
                  </h3>
                </div>
                <div className="divide-y divide-gray-200">
                  {participants
                    .filter(p => p.participant.status === 'confirmed' && p.scores.total_score !== null)
                    .sort((a, b) => (a.scores.total_score || Infinity) - (b.scores.total_score || Infinity))
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
                        <div key={participant.id} className={`flex items-center gap-4 p-4 ${isCurrentUser ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                          {/* Position */}
                          <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center">
                            {index === 0 ? (
                              <div className="w-10 h-10 bg-yellow-400 rounded-full flex items-center justify-center">
                                <i className="fas fa-trophy text-yellow-900 text-lg"></i>
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
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                              <span className="text-white text-sm font-bold">
                                {getInitials(displayName)}
                              </span>
                            </div>
                          )}

                          {/* Name */}
                          <div className="flex-1 min-w-0">
                            <div className={`font-black text-base ${isCurrentUser ? 'text-blue-700' : 'text-gray-900'}`}>
                              {displayName}
                              {isCurrentUser && <span className="ml-2 text-sm">(You)</span>}
                            </div>
                            <div className="text-sm text-gray-600">
                              {scores.holes_completed} of {golf_data.holes_played} holes
                            </div>
                          </div>

                          {/* Score */}
                          <div className="text-right">
                            <div className="text-3xl font-black text-green-900">{scores.total_score}</div>
                            {scores.to_par !== null && (
                              <div className={`text-sm font-bold ${scores.to_par < 0 ? 'text-blue-600' : scores.to_par > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                                {scores.to_par >= 0 ? '+' : ''}{scores.to_par}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                  {/* Players without scores */}
                  {participants
                    .filter(p => p.participant.status === 'confirmed' && !p.scores.total_score)
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
                            <div className={`font-bold text-base ${isCurrentUser ? 'text-blue-700' : 'text-gray-600'}`}>
                              {displayName}
                              {isCurrentUser && <span className="ml-2 text-sm">(You)</span>}
                            </div>
                            <div className="text-sm text-gray-500 italic">
                              {isCurrentUser && onAddScores ? 'Tap to add your scores' : 'Awaiting scores'}
                            </div>
                          </div>

                          {isCurrentUser && onAddScores && (
                            <button
                              onClick={() => onAddScores(participant.id)}
                              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-colors"
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
                <div className="bg-blue-100 border-2 border-blue-300 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {participants
                      .filter(p => p.participant.status === 'confirmed' && p.scores.total_score)
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
                            <div className="font-bold text-sm text-blue-900 mb-1">{displayName}</div>
                            <div className="text-3xl font-black text-blue-900">{scores.total_score}</div>
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
              <div className="flex items-center gap-4 text-xs text-gray-600 mb-4">
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded ring-2 ring-blue-500 ring-inset bg-white"></div>
                  <span>Eagle (-2)</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-5 h-5 rounded ring-1 ring-blue-400 ring-inset bg-white"></div>
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
        </div>

        {/* Actions for Current User */}
        <div className="border-t border-gray-300 p-4 bg-gray-50">
          {currentUserParticipant && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  {currentUserParticipant.scores.total_score ? (
                    <div>
                      <span className="font-bold text-gray-900">Your Score: </span>
                      <span className="text-2xl font-black text-blue-900">{currentUserParticipant.scores.total_score}</span>
                      {currentUserParticipant.scores.to_par !== null && (
                        <span className={`ml-2 text-lg font-bold ${currentUserParticipant.scores.to_par < 0 ? 'text-green-600' : currentUserParticipant.scores.to_par > 0 ? 'text-red-600' : 'text-gray-600'}`}>
                          ({currentUserParticipant.scores.to_par >= 0 ? '+' : ''}{currentUserParticipant.scores.to_par})
                        </span>
                      )}
                    </div>
                  ) : (
                    <div>
                      <span className="font-bold text-gray-900">You haven&apos;t added your scores yet</span>
                    </div>
                  )}
                </div>
                {onAddScores && (
                  <button
                    onClick={() => onAddScores(currentUserParticipant.participant.id)}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                  >
                    {currentUserParticipant.scores.total_score ? 'Edit Scores' : 'Add Scores'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-gray-100 border-t border-gray-300 p-4 flex justify-end">
          <button
            onClick={onClose}
            className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
