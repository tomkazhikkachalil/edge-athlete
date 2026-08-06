// GolfRoundCard — sport-specific post body for golf round recaps.
// Extracted verbatim from PostCard.tsx (Phase B seam: sport post bodies are
// dispatched by sport_key via SportPostBody instead of inlined in the shared
// feed card). Pure render, no state — expansion uses native <details>.
import type { GolfRound } from '@/types/golf';

export default function GolfRoundCard({ round }: { round: GolfRound }) {
  return (
    <>
    <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-950/40 dark:to-green-950/60 rounded-lg p-3 mt-2 border border-green-200 dark:border-green-800">
      {/* Compact Header with Score */}
      <div className="flex items-center justify-between mb-2">
        {/* min-w-0 + truncate: a long course name shortens instead of pushing
            the score badge out of the card. */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <i className="fas fa-golf-ball text-green-600 dark:text-green-400 text-base shrink-0"></i>
            <span className="font-bold text-green-900 dark:text-green-100 text-base min-w-0 truncate">{round.course}</span>
            {/* Round Type Badge - Indoor or Outdoor */}
            {round.round_type === 'indoor' ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-brand text-white text-xs font-bold rounded-full">
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
          <div className="flex items-center gap-3 text-sm text-green-800 dark:text-green-200 font-semibold flex-wrap">
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
              <div className="bg-surface rounded-lg px-4 py-2 shadow-md border-2 border-green-300 dark:border-green-700">
                <div className="text-3xl font-black text-green-900 dark:text-green-100 leading-none">{round.gross_score}</div>
                {toPar !== null && (
                  <div className={`text-sm font-bold ${toPar < 0 ? 'text-brand-fg' : 'text-red-600 dark:text-red-400'}`}>
                    {toPar >= 0 ? '+' : ''}{toPar}
                  </div>
                )}
                {holesPlayed > 0 && holesPlayed < 18 && (
                  <div className="text-[10px] text-green-700 dark:text-green-300 font-medium mt-0.5">
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
        <div className="flex items-center gap-x-5 gap-y-1 text-sm bg-surface/60 rounded px-3 py-2 mb-2 flex-wrap">
          {round.total_putts && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 dark:text-green-200 font-semibold">Putts:</span>
              <span className="font-bold text-green-900 dark:text-green-100">{round.total_putts}</span>
            </div>
          )}
          {round.fir_percentage !== null && round.fir_percentage !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 dark:text-green-200 font-semibold">FIR:</span>
              <span className="font-bold text-green-900 dark:text-green-100">{Math.round(round.fir_percentage)}%</span>
            </div>
          )}
          {round.gir_percentage !== null && round.gir_percentage !== undefined && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 dark:text-green-200 font-semibold">GIR:</span>
              <span className="font-bold text-green-900 dark:text-green-100">{Math.round(round.gir_percentage)}%</span>
            </div>
          )}
        </div>
      )}

      {/* Additional Round Details - Weather, Conditions, Rating */}
      {(round.weather || round.temperature || round.wind || round.course_rating || round.slope_rating) && (
        <div className="flex flex-wrap items-center gap-4 text-xs bg-surface/40 rounded px-3 py-1.5 mb-2">
          {round.weather && (
            <div className="flex items-center gap-1.5">
              <i className="fas fa-cloud-sun text-green-700 dark:text-green-300"></i>
              <span className="font-semibold text-green-900 dark:text-green-100">{round.weather}</span>
            </div>
          )}
          {round.temperature && (
            <div className="flex items-center gap-1.5">
              <i className="fas fa-thermometer-half text-green-700 dark:text-green-300"></i>
              <span className="font-semibold text-green-900 dark:text-green-100">{round.temperature}°F</span>
            </div>
          )}
          {round.wind && (
            <div className="flex items-center gap-1.5">
              <i className="fas fa-wind text-green-700 dark:text-green-300"></i>
              <span className="font-semibold text-green-900 dark:text-green-100">{round.wind}</span>
            </div>
          )}
          {round.course_rating && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 dark:text-green-200 font-medium">Rating:</span>
              <span className="font-bold text-green-900 dark:text-green-100">{round.course_rating}</span>
            </div>
          )}
          {round.slope_rating && (
            <div className="flex items-center gap-1.5">
              <span className="text-green-800 dark:text-green-200 font-medium">Slope:</span>
              <span className="font-bold text-green-900 dark:text-green-100">{round.slope_rating}</span>
            </div>
          )}
        </div>
      )}

      {/* Collapsible Traditional Scorecard */}
      {round.golf_holes && round.golf_holes.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs font-medium text-green-700 dark:text-green-300 hover:text-green-900 dark:text-green-100 flex items-center gap-1 py-1">
            <i className="fas fa-chevron-right group-open:rotate-90 transition-transform text-[10px]"></i>
            View Scorecard ({round.golf_holes.length} holes)
          </summary>
          <div className="mt-3 -mx-3 sm:mx-0">
            {/* Traditional Scorecard Layout - horizontal scroll on mobile */}
            <div className="bg-surface rounded border border-border-strong overflow-x-auto">
              {/* Front 9 */}
              {round.golf_holes.filter((h) => h.hole_number <= 9).length > 0 && (
                <div className="border-b-2 border-gray-400">
                  <table className="w-full min-w-[500px] text-xs">
                    <thead>
                      <tr className="bg-green-100 dark:bg-green-950/60 border-b border-border-strong">
                        <th className="text-left py-1.5 px-2 font-bold text-green-900 dark:text-green-100">HOLE</th>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => (
                            <th key={hole.hole_number} className="text-center py-1.5 px-1 font-black text-green-900 dark:text-green-100">
                              {hole.hole_number}
                            </th>
                          ))}
                        <th className="text-center py-1.5 px-2 font-black text-green-900 dark:text-green-100 bg-green-200">OUT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Yardage Row */}
                      <tr className="border-b border-border bg-surface-muted">
                        <td className="py-1.5 px-2 font-bold text-primary">YDS</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 font-semibold text-secondary">
                              {hole.distance_yards || '-'}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-bold text-primary bg-surface-sunken">
                          {round.golf_holes
                            .filter((h) => h.hole_number <= 9)
                            .reduce((sum: number, h) => sum + (h.distance_yards || 0), 0) || '-'}
                        </td>
                      </tr>
                      {/* Par Row */}
                      <tr className="border-b border-border-strong bg-yellow-50 dark:bg-yellow-950/40">
                        <td className="py-1.5 px-2 font-bold text-primary">PAR</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 font-bold text-primary">
                              {hole.par}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-black text-primary bg-yellow-100 dark:bg-yellow-950/60">
                          {round.golf_holes
                            .filter((h) => h.hole_number <= 9)
                            .reduce((sum: number, h) => sum + (h.par || 0), 0)}
                        </td>
                      </tr>
                      {/* Score Row */}
                      <tr className="border-b-2 border-gray-400">
                        <td className="py-2 px-2 font-black text-primary">SCORE</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => {
                            const diff = (hole.strokes ?? 0) - hole.par;
                            const bgColor = 'bg-surface';
                            let textColor = 'text-primary';
                            let border = '';

                            if (diff === -2) { // Eagle
                              border = 'ring-2 ring-violet-500 ring-inset';
                              textColor = 'text-brand-fg font-black';
                            } else if (diff === -1) { // Birdie
                              border = 'ring-1 ring-violet-400 ring-inset';
                              textColor = 'text-brand-fg font-bold';
                            } else if (diff === 1) { // Bogey
                              border = 'border border-red-400 dark:border-red-600';
                              textColor = 'text-red-600 dark:text-red-400 font-semibold';
                            } else if (diff >= 2) { // Double+
                              border = 'ring-2 ring-red-500 ring-inset';
                              textColor = 'text-red-600 dark:text-red-400 font-bold';
                            } else { // Par
                              textColor = 'text-primary font-semibold';
                            }

                            return (
                              <td key={hole.hole_number} className="text-center py-1.5 px-1">
                                <div className={`${bgColor} ${textColor} ${border} rounded mx-auto w-7 h-7 flex items-center justify-center text-sm`}>
                                  {hole.strokes}
                                </div>
                              </td>
                            );
                          })}
                        <td className="text-center py-2 px-2 bg-brand-soft">
                          <span className="font-black text-violet-900 dark:text-violet-200 text-base">
                            {round.golf_holes
                              .filter((h) => h.hole_number <= 9)
                              .reduce((sum: number, h) => sum + (h.strokes || 0), 0)}
                          </span>
                        </td>
                      </tr>
                      {/* Putts Row */}
                      <tr className="bg-surface-muted">
                        <td className="py-1.5 px-2 text-xs font-semibold text-secondary">Putts</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number <= 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 text-xs font-medium text-secondary">
                              {hole.putts || '-'}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-bold text-primary bg-surface-sunken">
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
                      <tr className="bg-green-100 dark:bg-green-950/60 border-b border-border-strong">
                        <th className="text-left py-1.5 px-2 font-bold text-green-900 dark:text-green-100">HOLE</th>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => (
                            <th key={hole.hole_number} className="text-center py-1.5 px-1 font-black text-green-900 dark:text-green-100">
                              {hole.hole_number}
                            </th>
                          ))}
                        <th className="text-center py-1.5 px-2 font-black text-green-900 dark:text-green-100 bg-green-200">IN</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Yardage */}
                      <tr className="border-b border-border bg-surface-muted">
                        <td className="py-1.5 px-2 font-bold text-primary">YDS</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 font-semibold text-secondary">
                              {hole.distance_yards || '-'}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-bold text-primary bg-surface-sunken">
                          {round.golf_holes
                            .filter((h) => h.hole_number > 9)
                            .reduce((sum: number, h) => sum + (h.distance_yards || 0), 0) || '-'}
                        </td>
                      </tr>
                      {/* Par */}
                      <tr className="border-b border-border-strong bg-yellow-50 dark:bg-yellow-950/40">
                        <td className="py-1.5 px-2 font-bold text-primary">PAR</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 font-bold text-primary">
                              {hole.par}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-black text-primary bg-yellow-100 dark:bg-yellow-950/60">
                          {round.golf_holes
                            .filter((h) => h.hole_number > 9)
                            .reduce((sum: number, h) => sum + (h.par || 0), 0)}
                        </td>
                      </tr>
                      {/* Score */}
                      <tr className="border-b border-border-strong">
                        <td className="py-2 px-2 font-black text-primary">SCORE</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => {
                            const diff = (hole.strokes ?? 0) - hole.par;
                            let textColor = 'text-primary';
                            let border = '';

                            if (diff === -2) {
                              border = 'ring-2 ring-violet-500 ring-inset';
                              textColor = 'text-brand-fg font-black';
                            } else if (diff === -1) {
                              border = 'ring-1 ring-violet-400 ring-inset';
                              textColor = 'text-brand-fg font-bold';
                            } else if (diff === 1) {
                              border = 'border border-red-400 dark:border-red-600';
                              textColor = 'text-red-600 dark:text-red-400 font-semibold';
                            } else if (diff >= 2) {
                              border = 'ring-2 ring-red-500 ring-inset';
                              textColor = 'text-red-600 dark:text-red-400 font-bold';
                            } else {
                              textColor = 'text-primary font-semibold';
                            }

                            return (
                              <td key={hole.hole_number} className="text-center py-1.5 px-1">
                                <div className={`bg-surface ${textColor} ${border} rounded mx-auto w-7 h-7 flex items-center justify-center text-sm`}>
                                  {hole.strokes}
                                </div>
                              </td>
                            );
                          })}
                        <td className="text-center py-2 px-2 bg-brand-soft">
                          <span className="font-black text-violet-900 dark:text-violet-200 text-base">
                            {round.golf_holes
                              .filter((h) => h.hole_number > 9)
                              .reduce((sum: number, h) => sum + (h.strokes || 0), 0)}
                          </span>
                        </td>
                      </tr>
                      {/* Putts */}
                      <tr className="bg-surface-muted">
                        <td className="py-1.5 px-2 text-xs font-semibold text-secondary">Putts</td>
                        {round.golf_holes
                          .filter((h) => h.hole_number > 9)
                          .map((hole) => (
                            <td key={hole.hole_number} className="text-center py-1.5 px-1 text-xs font-medium text-secondary">
                              {hole.putts || '-'}
                            </td>
                          ))}
                        <td className="text-center py-1.5 px-2 font-bold text-primary bg-surface-sunken">
                          {round.golf_holes
                            .filter((h) => h.hole_number > 9)
                            .reduce((sum: number, h) => sum + (h.putts || 0), 0) || '-'}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Total Score Row */}
                  <div className="bg-violet-100 border-t-2 border-violet-300 px-2 py-1.5 flex justify-between items-center">
                    <span className="text-xs font-bold text-violet-900 dark:text-violet-200">TOTAL SCORE</span>
                    <span className="text-lg font-black text-violet-900 dark:text-violet-200">
                      {round.gross_score}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Legend */}
            <div className="mt-2 flex items-center gap-3 text-[9px] text-tertiary">
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded ring-2 ring-violet-500 ring-inset"></div>
                <span>Eagle</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded ring-1 ring-violet-400 ring-inset"></div>
                <span>Birdie</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-4 h-4 rounded border border-red-400 dark:border-red-600"></div>
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
