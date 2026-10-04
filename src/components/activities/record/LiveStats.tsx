'use client';

import { ACTIVITY_TYPE_DEFS, STEP_TYPES, type ActivityType } from '@/lib/activities/catalog';
import { formatDistance, formatDuration, formatElevation, formatPace, type DistanceUnit } from '@/lib/activities/format';
import type { LiveTotals } from '@/lib/activities/record/recording';

function hms(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** What the screen shows while recording — the server recomputes every number at Finish. */
export default function LiveStats({ type, totals, unit, gps }: { type: ActivityType; totals: LiveTotals; unit: DistanceUnit; gps: { status: string; accuracy: number | null; stale: boolean } | null }) {
  const def = ACTIVITY_TYPE_DEFS[type];
  const showDistance = def.recording !== 'duration';
  const current = totals.currentPaceSPerM !== null ? formatPace(1000, totals.currentPaceSPerM * 1000, type, unit) : null;
  const avg = totals.avgPaceSPerM !== null ? formatPace(1000, totals.avgPaceSPerM * 1000, type, unit) : null;
  return (
    <section aria-label="Live numbers" className="px-4" data-record-stats="">
      <p className="text-center text-[56px] leading-none font-bold tabular-nums text-primary" data-record-timer="">
        {hms(totals.elapsedS)}
      </p>
      {gps && def.recording === 'gps' && (
        <p className="mt-1 text-center text-xs" data-record-gps={gps.status}>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${gps.stale || gps.status === 'denied' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-surface-muted text-secondary'}`}>
            <i className="fas fa-location-dot" aria-hidden="true"></i>
            {gps.status === 'denied' ? 'GPS off' : gps.accuracy !== null ? `GPS ±${Math.round(gps.accuracy)} m` : 'Finding GPS…'}
            {gps.stale && gps.status !== 'denied' ? ' · no fix' : ''}
          </span>
        </p>
      )}
      {showDistance && (
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <div className="ea-surface rounded-lg p-3">
            <dt className="text-xs text-secondary">Distance</dt>
            <dd className="text-2xl font-bold tabular-nums text-primary" data-record-distance={totals.distanceM}>
              {formatDistance(totals.distanceM, unit)}
            </dd>
          </div>
          <div className="ea-surface rounded-lg p-3">
            <dt className="text-xs text-secondary">{def.paceStyle === 'speed' ? 'Speed' : 'Pace'}</dt>
            <dd className="text-2xl font-bold tabular-nums text-primary">{current?.value ?? '—'}</dd>
          </div>
          <div className="ea-surface rounded-lg p-3">
            <dt className="text-xs text-secondary">{avg?.label ?? (def.paceStyle === 'speed' ? 'Avg speed' : 'Avg pace')}</dt>
            <dd className="text-xl font-semibold tabular-nums text-primary">{avg?.value ?? '—'}</dd>
          </div>
          <div className="ea-surface rounded-lg p-3">
            <dt className="text-xs text-secondary">Elevation</dt>
            <dd className="text-xl font-semibold tabular-nums text-primary">{totals.elevGainM !== null ? formatElevation(totals.elevGainM, unit) : '—'}</dd>
          </div>
        </dl>
      )}
      {STEP_TYPES.has(type) && totals.steps !== null && (
        <p className="mt-3 text-center text-sm text-secondary" data-record-steps={totals.steps}>
          ~{totals.steps.toLocaleString()} steps <span className="text-muted">(est.)</span>
        </p>
      )}
      <p className="sr-only">Moving {formatDuration(totals.movingS)}</p>
    </section>
  );
}
