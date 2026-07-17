// GolfStatsSummaryCard — compact stats_data summary for golf posts without a
// full round attached. Extracted from PostCard.tsx (Phase B seam).

export default function GolfStatsSummaryCard({ statsData }: { statsData: Record<string, unknown> }) {
  return (
    <>
    <div className="bg-gray-50 rounded-lg p-micro mt-micro">
      <div className="text-xs text-gray-900 mb-1 font-bold">Golf Stats</div>
      {statsData.type === 'round_recap' && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="font-medium">Score:</span> {String(statsData.grossScore ?? '')}
          </div>
          {Boolean(statsData.course) && (
            <div>
              <span className="font-medium">Course:</span> {String(statsData.course)}
            </div>
          )}
          {Boolean(statsData.firPercentage) && (
            <div>
              <span className="font-medium">FIR:</span> {Math.round(Number(statsData.firPercentage))}%
            </div>
          )}
          {Boolean(statsData.totalPutts) && (
            <div>
              <span className="font-medium">Putts:</span> {String(statsData.totalPutts)}
            </div>
          )}
        </div>
      )}
      {statsData.type === 'hole_highlight' && (
        <div className="text-xs">
          <span className="font-medium">Hole {String(statsData.holeNumber ?? '')}:</span>
          {' '}{String(statsData.score ?? '')} on Par {String(statsData.par ?? '')}
          {Boolean(statsData.club) && (
            <span> • {String(statsData.club)}</span>
          )}
        </div>
      )}
    </div>
    </>
  );
}
