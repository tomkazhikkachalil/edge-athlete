'use client';

import Sparkline from './Sparkline';
import { compact, pct } from '@/lib/platform-stats/overview';

/**
 * The stat tile (the dataviz contract): a sentence-case label, a compact
 * value, an optional signed delta against the previous window, a sparkline
 * of the range, and a short sub line. "≈" marks an estimate. Text wears the
 * text tokens; only the sparkline carries a hue.
 */
export default function StatTile(props: {
  label: string;
  value: number | string | null;
  approx?: boolean;
  delta?: number | null;
  series?: readonly (number | null)[];
  sub?: string;
  hook?: string;
}) {
  const value = typeof props.value === 'string' ? props.value : compact(props.value);
  const delta = props.delta ?? null;
  return (
    <div className="rounded-lg border border-border px-3 py-2 min-w-0 bg-surface" data-overview-tile={props.hook ?? props.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
      <dt className="text-[11px] uppercase tracking-wide text-muted truncate">{props.label}</dt>
      <dd className="mt-0.5 flex items-end justify-between gap-2">
        <span className="text-lg font-semibold text-primary tabular-nums" data-overview-value={typeof props.value === 'number' ? props.value : undefined}>
          {props.approx && value !== '—' ? '≈ ' : ''}{value}
        </span>
        {props.series && <Sparkline series={props.series} />}
      </dd>
      {(delta !== null || props.sub) && (
        <p className="mt-0.5 text-xs text-muted truncate">
          {delta !== null && (
            <span className={delta > 0 ? 'text-success-fg' : delta < 0 ? 'text-warning-fg' : ''} data-overview-delta={delta}>
              {delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} {pct(Math.abs(delta))}
            </span>
          )}
          {delta !== null && props.sub ? ' · ' : ''}
          {props.sub}
        </p>
      )}
    </div>
  );
}
