'use client';

// A shared activity on the feed (Activities, 245): drawn entirely from the
// post's stats_data — which the SERVER wrote from the athlete's row (the
// trimmed preview; none for a supervised athlete), so scrolling costs no
// fetch. The route is a line drawing (RouteThumb), never Leaflet. The whole
// card opens the activity page. It adds nothing to the post's action row
// (the Play review's 375 px clipping lesson).

import Link from 'next/link';
import { useState } from 'react';
import { ACTIVITY_TYPE_DEFS } from '@/lib/activities/catalog';
import { formatDistance, formatDuration, formatElevation, formatPace, readUnitPreference, type DistanceUnit } from '@/lib/activities/format';
import { isActivityPostStats } from '@/lib/activities/post-card';
import RouteThumb from './RouteThumb';

export default function ActivityPostCard({ statsData }: { statsData: unknown }) {
  const [unit] = useState<DistanceUnit>(() => (typeof window === 'undefined' ? 'km' : readUnitPreference()));
  if (!isActivityPostStats(statsData)) return null;
  const s = statsData;
  const def = ACTIVITY_TYPE_DEFS[s.activity_type];
  const seconds = s.moving_s ?? s.elapsed_s;
  const pace = formatPace(s.distance_m, seconds, s.activity_type, unit);
  const cells = [
    { label: 'Distance', value: formatDistance(s.distance_m, unit) },
    { label: 'Time', value: formatDuration(seconds) },
    pace,
    { label: 'Elevation', value: formatElevation(s.elev_gain_m, unit) },
  ];
  return (
    <Link href={`/activities/${s.activity_id}`} className="mt-3 block rounded-lg border border-border bg-surface-muted/40 overflow-hidden ea-interactive" data-activity-post-card={s.activity_id}>
      {s.route_preview && (
        <div className="bg-brand-soft/60 text-brand-fg">
          <RouteThumb preview={s.route_preview} className="block h-36 w-full" w={320} h={144} />
        </div>
      )}
      <div className="p-3">
        <p className="flex items-center gap-2 font-semibold text-primary min-w-0">
          <i className={`fas fa-${def.icon} text-brand-fg`} aria-hidden="true" />
          <span className="truncate">{s.name}</span>
        </p>
        <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {cells.map(c => (
            <div key={c.label} className="min-w-0">
              <dt className="text-xs text-muted">{c.label}</dt>
              <dd className="text-sm font-bold text-primary tabular-nums truncate">{c.value}</dd>
            </div>
          ))}
        </dl>
        {s.credit && <p className="mt-2 text-xs text-muted" data-activity-credit>{s.credit}</p>}
      </div>
    </Link>
  );
}
