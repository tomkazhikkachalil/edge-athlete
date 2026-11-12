'use client';

import { formatDistance, formatDuration, type DistanceUnit } from '@/lib/activities/format';
import type { WeekTotal } from '@/lib/activities/totals';
import { shortActivityDate } from './ActivityHistoryRow';

/** The activities' week and their last twelve weeks of distance — shown above History's list when it is filtered to Activities. */
export default function ActivityWeekTotals({ totals, unit }: { totals: WeekTotal[]; unit: DistanceUnit }) {
  if (totals.length === 0) return null;
  const thisWeek = totals[totals.length - 1];
  const maxDist = totals.reduce((m, w) => (w.distanceM > m ? w.distanceM : m), 0);
  const span = totals.reduce((t, w) => ({ distanceM: t.distanceM + w.distanceM, count: t.count + w.count }), { distanceM: 0, count: 0 });
  return (
    <section className="ea-surface rounded-lg p-4" data-activities-totals>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-primary">This week</h4>
        <p className="text-sm text-secondary tabular-nums">
          {formatDistance(thisWeek.distanceM, unit)} · {formatDuration(thisWeek.seconds)} · {thisWeek.count} {thisWeek.count === 1 ? 'activity' : 'activities'}
        </p>
      </div>
      <div className="mt-4 flex items-end gap-1 h-20" role="img" aria-label="Distance per week, last 12 weeks">
        {totals.map(w => (
          <div key={w.weekStart} className="flex-1 flex flex-col justify-end h-full" title={`${shortActivityDate(w.weekStart)}: ${formatDistance(w.distanceM, unit)}`}>
            <div
              className={`rounded-t ${w === thisWeek ? 'bg-brand' : w.distanceM > 0 ? 'bg-brand/45' : 'bg-border'}`}
              style={{ height: `${maxDist > 0 ? Math.max(w.distanceM > 0 ? 6 : 2, (w.distanceM / maxDist) * 100) : 2}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted" aria-hidden="true">
        <span>{shortActivityDate(totals[0].weekStart)}</span>
        <span>This week</span>
      </div>
      <p className="mt-3 text-sm text-secondary tabular-nums">
        Last 12 weeks: <span className="font-semibold text-primary">{formatDistance(span.distanceM, unit)}</span> · {span.count} {span.count === 1 ? 'activity' : 'activities'}
      </p>
    </section>
  );
}
