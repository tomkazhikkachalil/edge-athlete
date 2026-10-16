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
import { readUnitPreference, type DistanceUnit } from '@/lib/activities/format';
import { cardTileSource, isActivityPostStats } from '@/lib/activities/post-card';
import { tilesFor } from '@/lib/activities/tiles';
import RouteThumb from './RouteThumb';

export default function ActivityPostCard({ statsData }: { statsData: unknown }) {
  const [unit] = useState<DistanceUnit>(() => (typeof window === 'undefined' ? 'km' : readUnitPreference()));
  if (!isActivityPostStats(statsData)) return null;
  const s = statsData;
  const def = ACTIVITY_TYPE_DEFS[s.activity_type];
  // The type's first four tiles that have a value (tiles.ts) — a yoga card
  // reads its time, never "0 km".
  const { src, derived } = cardTileSource(s);
  const cells = tilesFor(src, derived, unit, 4);
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
            <div key={c.key} className="min-w-0" data-activity-card-cell={c.key}>
              <dt className="text-xs text-muted">{c.label}</dt>
              <dd className="text-sm font-bold text-primary tabular-nums truncate">{c.value}</dd>
            </div>
          ))}
        </dl>
        {(s.segments?.length || s.photo_count || typeof s.steps === 'number') && (
          <p className="mt-2 text-xs text-secondary" data-activity-card-extras>
            {[
              s.segments?.length ? `${s.segments.length} segment${s.segments.length === 1 ? '' : 's'}` : null,
              s.photo_count ? `${s.photo_count} photo${s.photo_count === 1 ? '' : 's'}` : null,
              typeof s.steps === 'number' ? `~${s.steps.toLocaleString()} steps (est.)` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
        {s.credit && <p className="mt-2 text-xs text-muted" data-activity-credit>{s.credit}</p>}
      </div>
    </Link>
  );
}
