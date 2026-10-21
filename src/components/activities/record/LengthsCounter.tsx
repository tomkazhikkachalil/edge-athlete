'use client';

/**
 * A pool swim's lengths, counted as they happen (Program F5, Oct 2026): one
 * big "+1 length" (≥ 56 px — a wet thumb), an undo, the pool line and the
 * live distance with the pace per 100 m. The count is a `lengthsSet` event
 * into the recording (storage.ts persists it); the distance is
 * lengths × the pool the athlete chose in the set-up or in Details
 * (pool.ts) — without a pool the lengths still count and the distance waits.
 */

import { isPoolLength, POOL_LENGTH_LABELS, POOL_LENGTH_M } from '@/lib/activities/pool';
import { formatDistance, type DistanceUnit } from '@/lib/activities/format';

function per100(distanceM: number, movingS: number): string | null {
  if (!(distanceM > 0) || !(movingS > 0)) return null;
  const s = Math.round((movingS / distanceM) * 100);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /100 m`;
}

export default function LengthsCounter({ lengths, pool, movingS, unit, disabled, onChange }: { lengths: number; pool: unknown; movingS: number; unit: DistanceUnit; disabled?: boolean; onChange: (lengths: number) => void }) {
  const poolKey = isPoolLength(pool) ? pool : null;
  const distanceM = poolKey ? lengths * POOL_LENGTH_M[poolKey] : null;
  const pace = distanceM !== null ? per100(distanceM, movingS) : null;
  return (
    <section className="mx-4 mt-4 rounded-xl border border-border bg-surface p-4" aria-label="Lengths" data-record-lengths={lengths}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold text-primary">Lengths</p>
        <p className="text-sm text-secondary" data-record-lengths-pool="">
          {poolKey ? `${POOL_LENGTH_LABELS[poolKey]} pool` : 'Choose the pool length in Details for the distance'}
        </p>
      </div>
      <p className="mt-2 flex items-baseline justify-between gap-3">
        <span className="text-[44px] leading-none font-bold tabular-nums text-primary" data-record-lengths-count={lengths}>{lengths}</span>
        <span className="text-right text-sm text-secondary">
          {distanceM !== null && <span className="block text-lg font-semibold tabular-nums text-primary" data-record-lengths-distance={distanceM}>{formatDistance(distanceM, unit)}</span>}
          {pace && <span className="block tabular-nums" data-record-lengths-pace="">{pace}</span>}
        </span>
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => onChange(lengths + 1)} disabled={disabled} className="ea-cta min-h-[56px] flex-1 rounded-lg text-lg font-bold text-white disabled:opacity-50" data-record-length-add="">
          +1 length
        </button>
        <button type="button" onClick={() => onChange(Math.max(0, lengths - 1))} disabled={disabled || lengths === 0} className="ea-interactive min-h-[56px] rounded-lg border border-border-strong bg-surface px-4 text-sm font-semibold text-primary disabled:opacity-50" data-record-length-undo="">
          Undo
        </button>
      </div>
    </section>
  );
}
