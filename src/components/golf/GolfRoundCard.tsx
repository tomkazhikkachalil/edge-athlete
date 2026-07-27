// GolfRoundCard — sport-specific post body for golf round recaps.
// Extracted verbatim from PostCard.tsx (Phase B seam: sport post bodies are
// dispatched by sport_key via SportPostBody instead of inlined in the shared
// feed card). Pure render, no state — expansion uses native <details>.
import type { GolfRound } from '@/types/golf';

export default function GolfRoundCard({ round }: { round: GolfRound }) {
  return (
    <>
    <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 mt-2 border border-green-200">
      {/* Compact Header with Score */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <i className="fas fa-golf-ball text-green-600 text-base"></i>
            <span className="font-bold text-green-900 text-base">{round.course}</span>
            {/* Round Type Badge - Indoor or Outdoor */}
            {round.round_type === 'indoor' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-600 text-white text-xs font-bold rounded-full">
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
            {round.date && (
              <span>{new Date(round.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            )}
            {round.tee && <span>• {round.tee.charAt(0).toUpperCase() + round.tee.slice(1)} Tees</span>}
            {round.holes && <span>• {round.holes} Holes</span>}
          </div>
        </div>

        {/* Large Score Badge */}
        {round.gross_score !== null && round.gross_score !== undefined && (() => {
          // Calculate actual par from recorded holes
          const actualPar = round.golf_holes?.reduce((sum: number, hole) => sum + (hole.par || 0), 0) || 0;
          const holesPlayed = round.golf_holes?.length || 0;
          const toPar = actualPar > 0 ? round.gross_score - actualPar : null;

          return (
            <div className="text-right ml-3">
              <div className="bg-white rounded-lg px-4 py-2 shadow-md border-2 border-green-300">
                <div className="text-3xl font-black text-green-900 leading-none">{round.gross_score}</div>
                {toPar !== null && (
                  <div className={`text-sm font-bold ${toPar < 0 ? 'text-violet-600' : 'text-red-600'}`}>
                    {toPar >= 0 ? '+' : ''}{toPar}
                  </div>
                )}
                {holesPlayed > 0 && holesPlayed < 18 && (
                  <div className="text-[10px] text-green-700 font-medium mt-0.5">
                    Through {holesPlayed}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Inline Stats Bar */}
      {(round.total_putts || round.fir_percentage !== null || round.gir_percentage !== null) && (
        <div className="flex items-center gap-5 text-sm bg-white/60 rounded px-3 py-2 mb-2">
          {round.total_putts && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 font-semibold">Putts:</span>
              <span className="font-bold text-green-900">{round.total_putts}</span>
            </div>
          )}
          {round.fir_percentage !== null && round.fir_percentage !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 font-semibold">FIR:</span>
              <span className="font-bold text-green-900">{Math.round(round.fir_percentage)}%</span>
            </div>
          )}
          {round.gir_percentage !== null && round.gir_percentage !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 font-semibold">GIR:</span>
              <span className="font-bold text-green-900">{Math.round(round.gir_percentage)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Additional Round Details - Weather, Conditions, Rating */}
      {(round.weather || round.temperature || round.wind || round.course_rating || round.slope_rating) && (
        <div className="flex flex-wrap items-center gap-4 text-xs bg-white/40 rounded px-3 py-1.5 mb-2">
          {round.weather && (
            <div className="flex items-center gap-1.5">
              <i className="fas fa-cloud-sun text-green-700"></i>
              <span className="font-semibold text-green-900">{round.weather}</span>
            </div>
          )}
          {round.temperature && (
            <div className="flex items-center gap-1.5">
              <i className="fas fa-thermometer-half text-green-700"></i>
              <span className="font-semibold text-green-900">{round.temperature}°F</span>
            </div>
          )}
          {round.wind && (
            <div className="flex items-center gap-1.5">
              <i className="fas fa-wind text-green-700"></i>
              <span className="font-semibold text-green-900">{round.wind}</span>
            </div>
          )}
          {round.course_rating && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 font-medium">Rating:</span>
              <span className="font-bold text-green-900">{round.course_rating}</span>
            </div>
          )}
          {round.slope_rating && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 font-medium">Slope:</span>
              <span className="font-bold text-green-900">{round.slope_rating}</span>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Traditional Scorecard */}
      {round.golf_holes && round.golf_holes.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-green-700 hover:text-green-900 flex items-center gap-1 py-1">
            <i className="fas fa-chevron-right group-open:rotate-90 transition-transform text-[10px]"></i>
            View Scorecard ({round.golf_holes.length} holes)
          </summary>
          <div className="mt-3 -mx-3 sm:mx-0">
            {/* Traditional Scorecard Layout - horizontal scroll on mobile */}
            <div className="bg-white rounded border border-gray-300 overflow-x-auto">
              {/* Front 9 */}
              {round.golf_holes.filter((h) => h.hole_number <= 9).length > 0 && (
                <div className="border-b-2 border-gray-400">
                  <table className="w-full min-w-[500px] text-xs">
                    <thead>
                      <tr className="bg-green-100 border-b border-gray-300">
                        <th className="text-left py-1.5 px-2 font-bold text-green-900">HOLE</th>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => (
                            <th key={hole.hole_number} className="text-center py-1.5 px-1 font-black text-green-900">
                              {hole.hole_number}
                            </th>
                          ))}
                        <th className="text-center py-1.5 px-2 font-black text-green-900 bg-green-200">OUT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Yardage Row */}
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <td className="py-1.5 px-2 font-bold text-gray-800">YDS</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 font-semibold text-gray-700">
                              {hole.distance_yards || '-'}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-bold text-gray-800 bg-gray-100">
                          {round.golf_holes
                            .filter((h) => h.hole_number <= 9)
                            .reduce((sum: number, h) => sum + (h.distance_yards || 0), 0) || '-'}
                        </td>
                      </tr>
                      {/* Par Row */}
                      <tr className="border-b border-gray-300 bg-yellow-50">
                        <td className="py-1.5 px-2 font-bold text-gray-900">PAR</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 font-bold text-gray-900">
                              {hole.par}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-black text-gray-900 bg-yellow-100">
                          {round.golf_holes
                            .filter((h) => h.hole_number <= 9)
                            .reduce((sum: number, h) => sum + (h.par || 0), 0)}
                        </td>
                      </tr>
                      {/* Score Row */}
                      <tr className="border-b-2 border-gray-400">
                        <td className="py-2 px-2 font-black text-gray-900">SCORE</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => {
                            const diff = (hole.strokes ?? 0) - hole.par;
                            const bgColor = 'bg-white';
                            let textColor = 'text-gray-900';
                            let border = '';

                            if (diff === -2) { // Eagle
                              border = 'ring-2 ring-violet-500 ring-inset';
                              textColor = 'text-violet-600 font-black';
                            } else if (diff === -1) { // Birdie
                              border = 'ring-1 ring-violet-400 ring-inset';
                              textColor = 'text-violet-600 font-bold';
                            } else if (diff === 1) { // Bogey
                              border = 'border border-red-400';
                              textColor = 'text-red-600 font-semibold';
                            } else if (diff >= 2) { // Double+
                              border = 'ring-2 ring-red-500 ring-inset';
                              textColor = 'text-red-600 font-bold';
                            } else { // Par
                              textColor = 'text-gray-900 font-semibold';
                            }

                            return (
                              <td key={hole.hole_number} className="text-center py-1.5 px-1">
                                <div className={`${bgColor} ${textColor} ${border} rounded mx-auto w-7 h-7 flex items-center justify-center text-sm`}>
                                  {hole.strokes}
                                </div>
                              </td>
                            );
                          })}
                        <td className="text-center py-2 px-2 bg-violet-50">
                          <span className="font-black text-violet-900 text-base">
                            {round.golf_holes
                              .filter((h) => h.hole_number <= 9)
                              .reduce((sum: number, h) => sum + (h.strokes || 0), 0)}
                          </span>
                        </td>
                      </tr>
                      {/* Putts Row */}
                      <tr className="bg-gray-50">
                        <td className="py-1.5 px-2 text-xs font-semibold text-gray-700">Putts</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 text-xs font-medium text-gray-700">
                              {hole.putts || '-'}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-bold text-gray-800 bg-gray-100">
                          {round.golf_holes
                            .filter((h) => h.hole_number <= 9)
                            .reduce((sum: number, h) => sum + (h.putts || 0), 0) || '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Back 9 */}
              {round.golf_holes.filter((h) => h.hole_number > 9).length > 0 && (
                <div>
                  <table className="w-full min-w-[500px] text-xs">
                    <thead>
                      <tr className="bg-green-100 border-b border-gray-300">
                        <th className="text-left py-1.5 px-2 font-bold text-green-900">HOLE</th>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => (
                            <th key={hole.hole_number} className="text-center py-1.5 px-1 font-black text-green-900">
                              {hole.hole_number}
                            </th>
                          ))}
                        <th className="text-center py-1.5 px-2 font-black text-green-900 bg-green-200">IN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Yardage */}
                      <tr className="border-b border-gray-200 bg-gray-50">
                        <td className="py-1.5 px-2 font-bold text-gray-800">YDS</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 font-semibold text-gray-700">
                              {hole.distance_yards || '-'}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-bold text-gray-800 bg-gray-100">
                          {round.golf_holes
                            .filter((h) => h.hole_number > 9)
                            .reduce((sum: number, h) => sum + (h.distance_yards || 0), 0) || '-'}
                        </td>
                      </tr>
                      {/* Par */}
                      <tr className="border-b border-gray-300 bg-yellow-50">
                        <td className="py-1.5 px-2 font-bold text-gray-900">PAR</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 font-bold text-gray-900">
                              {hole.par}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-black text-gray-900 bg-yellow-100">
                          {round.golf_holes
                            .filter((h) => h.hole_number > 9)
                            .reduce((sum: number, h) => sum + (h.par || 0), 0)}
                        </td>
                      </tr>
                      {/* Score */}
                      <tr className="border-b border-gray-300">
                        <td className="py-2 px-2 font-black text-gray-900">SCORE</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => {
                            const diff = (hole.strokes ?? 0) - hole.par;
                            let textColor = 'text-gray-900';
                            let border = '';

                            if (diff === -2) {
                              border = 'ring-2 ring-violet-500 ring-inset';
                              textColor = 'text-violet-600 font-black';
                            } else if (diff === -1) {
                              border = 'ring-1 ring-violet-400 ring-inset';
                              textColor = 'text-violet-600 font-bold';
                            } else if (diff === 1) {
                              border = 'border border-red-400';
                              textColor = 'text-red-600 font-semibold';
                            } else if (diff >= 2) {
                              border = 'ring-2 ring-red-500 ring-inset';
                              textColor = 'text-red-600 font-bold';
                            } else {
                              textColor = 'text-gray-900 font-semibold';
                            }

                            return (
                              <td key={hole.hole_number} className="text-center py-1.5 px-1">
                                <div className={`bg-white ${textColor} ${border} rounded mx-auto w-7 h-7 flex items-center justify-center text-sm`}>
                                  {hole.strokes}
                                </div>
                              </td>
                            );
                          })}
                        <td className="text-center py-2 px-2 bg-violet-50">
                          <span className="font-black text-violet-900 text-base">
                            {round.golf_holes
                              .filter((h) => h.hole_number > 9)
                              .reduce((sum: number, h) => sum + (h.strokes || 0), 0)}
                          </span>
                        </td>
                      </tr>
                      {/* Putts */}
                      <tr className="bg-gray-50">
                        <td className="py-1.5 px-2 text-xs font-semibold text-gray-700">Putts</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 text-xs font-medium text-gray-700">
                              {hole.putts || '-'}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-bold text-gray-800 bg-gray-100">
                          {round.golf_holes
                            .filter((h) => h.hole_number > 9)
                            .reduce((sum: number, h) => sum + (h.putts || 0), 0) || '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Total Score Row */}
                  <div className="bg-violet-100 border-t-2 border-violet-300 px-2 py-1.5 flex justify-between items-center">
                    <span className="text-xs font-bold text-violet-900">TOTAL SCORE</span>
                    <span className="text-lg font-black text-violet-900">
                      {round.gross_score}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="mt-2 flex items-center gap-3 text-[9px] text-gray-600">
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded ring-2 ring-violet-500 ring-inset"></div>
                <span>Eagle</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded ring-1 ring-violet-400 ring-inset"></div>
                <span>Birdie</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded border border-red-400"></div>
                <span>Bogey</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded ring-2 ring-red-500 ring-inset"></div>
                <span>Double+</span>
              </div>
            </div>
          </div>
        </details>
      )}
    </div>
    </>
  );
}
