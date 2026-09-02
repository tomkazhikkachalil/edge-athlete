import type { CourseStats } from '@/lib/golf/course-stats';
import { formatIsoDate } from '@/lib/competitions/golf-weeks';
import { teeLabel } from '@/lib/golf/tees';

// "At this course" (phase 6e S3): the course page fills itself from the
// club members' PUBLIC rounds (the two-key rule, names already masked,
// supervised athletes omitted upstream). Props-only, server-safe, no
// profile links — the standings-board precedent: a name on a crawlable
// page is a label, never a door.

const teeName = (tee: string) => (tee === 'unknown' ? 'Unknown tee' : teeLabel(tee));

export function courseRecordLine(stats: CourseStats): string | null {
  const rec = stats.courseRecord[0];
  if (!rec) return null;
  return `Course record ${rec.gross} (${rec.holes} holes, ${teeName(rec.tee)}) — ${rec.name}, ${formatIsoDate(rec.date)}`;
}

export default function CourseStatsCard({ stats }: { stats: CourseStats }) {
  if (stats.roundsPosted === 0) {
    return (
      <section aria-label="At this course" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-primary">At this course</h2>
        <p className="mt-1 text-sm text-tertiary">
          No public rounds yet — members&apos; posted rounds appear here.
        </p>
      </section>
    );
  }
  return (
    <section aria-label="At this course" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-primary">At this course</h2>
      <p className="mt-1 text-sm text-secondary">
        {`${stats.roundsPosted} ${stats.roundsPosted === 1 ? 'round' : 'rounds'} posted by members in the last year.`}
      </p>

      {stats.courseRecord.length > 0 && (
        <ul className="mt-3 space-y-1" aria-label="Course records">
          {stats.courseRecord.map(rec => (
            <li key={`${rec.holes}-${rec.tee}`} className="text-sm text-primary">
              <span className="font-semibold">{`Record ${rec.gross}`}</span>
              <span className="text-muted">{` · ${rec.holes} holes · ${teeName(rec.tee)} · `}</span>
              <span>{rec.name}</span>
              <span className="text-muted">{`, ${formatIsoDate(rec.date)}`}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-1.5 pr-3 font-medium">Tee</th>
              <th scope="col" className="py-1.5 px-2 font-medium text-right">Holes</th>
              <th scope="col" className="py-1.5 px-2 font-medium text-right">Rounds</th>
              <th scope="col" className="py-1.5 px-2 font-medium text-right" title="Scoring average">Avg</th>
              <th scope="col" className="py-1.5 px-2 font-medium text-right">Best</th>
            </tr>
          </thead>
          <tbody>
            {stats.byTee.map(b => (
              <tr key={`${b.holes}-${b.tee}`} className="border-t border-border-subtle">
                <td className="py-1.5 pr-3 font-medium text-primary">{teeName(b.tee)}</td>
                <td className="py-1.5 px-2 text-right text-secondary">{b.holes}</td>
                <td className="py-1.5 px-2 text-right text-secondary">{b.rounds}</td>
                <td className="py-1.5 px-2 text-right text-secondary">{b.avgGross}</td>
                <td className="py-1.5 px-2 text-right text-secondary">{b.best.gross}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {stats.hardestHoles.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-primary">Hardest holes</h3>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-secondary">
            {stats.hardestHoles.map(h => (
              <li key={h.hole}>
                {`Hole ${h.hole}`}
                {h.par ? <span className="text-muted">{` (par ${h.par})`}</span> : null}
                {` +${h.avgOverPar}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.recentRounds.length > 0 && (
        <div className="mt-3">
          <h3 className="text-sm font-semibold text-primary">Recent rounds</h3>
          <ul className="mt-1 space-y-0.5 text-sm text-secondary">
            {stats.recentRounds.map((r, i) => (
              <li key={`${r.date}-${r.name}-${i}`}>
                <span className="font-medium text-primary">{r.gross}</span>
                <span className="text-muted">{` · ${r.holes} holes${r.tee ? ` · ${teeLabel(r.tee)}` : ''} · `}</span>
                {r.name}
                <span className="text-muted">{`, ${formatIsoDate(r.date)}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
