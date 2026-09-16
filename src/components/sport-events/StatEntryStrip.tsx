'use client';

import { applyIncrement, type StatValues } from '@/lib/sport-events/stats';
import type { SportStatSchema } from '@/lib/sports/stat-schemas';
import type { StatOutboxEntry } from '@/lib/sport-events/stat-outbox';

interface Props {
  name: string;
  schema: SportStatSchema;
  /** The line as shown (the outbox's pending state over the server's). */
  stats: StatValues;
  entry: StatOutboxEntry | null;
  onChange: (next: StatValues) => void;
  onResolve: (choice: 'mine' | 'theirs') => void;
  onRetry: () => void;
  onClose: () => void;
}

const CHIP = 'ea-interactive border border-border-strong text-primary min-w-[44px] min-h-[44px] rounded-lg text-lg font-bold inline-flex items-center justify-center disabled:opacity-40';

/**
 * The entry strip (Events program, phase 4): the selected player's fields
 * as −/+ chips, each tap ONE increment merged client-side into the
 * outbox's one desired state per line (`applyIncrement` refuses at the
 * schema's edge, never clamps). Owns the bottom edge of the live screen.
 */
export default function StatEntryStrip({ name, schema, stats, entry, onChange, onResolve, onRetry, onClose }: Props) {
  const bump = (key: string, delta: number) => {
    const r = applyIncrement(stats, key, delta, schema);
    if (r.ok) onChange(r.value);
  };
  const can = (key: string, delta: number) => applyIncrement(stats, key, delta, schema).ok;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 bg-surface border-t border-border safe-bottom" data-stat-strip="">
      <div className="max-w-2xl mx-auto px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold text-primary truncate">{name}</p>
          <span className="text-xs text-muted" data-stat-strip-state={entry?.state ?? 'saved'}>{entry?.state === 'pending' ? 'Saving…' : entry?.state === 'conflict' ? 'Conflict' : entry?.state === 'error' ? 'Not saved' : 'Saved'}</span>
          <button type="button" onClick={onClose} className="ea-icon-btn text-secondary" aria-label="Close">
            <i className="fas fa-times" aria-hidden="true"></i>
          </button>
        </div>
        {entry?.state === 'conflict' && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-primary bg-amber-50 dark:bg-amber-950/40 rounded-lg px-3 py-2" data-stat-conflict="">
            <span>Someone else changed this line.</span>
            <button type="button" onClick={() => onResolve('mine')} className="underline min-h-[44px]">Keep mine</button>
            <button type="button" onClick={() => onResolve('theirs')} className="underline min-h-[44px]">Take theirs</button>
          </div>
        )}
        {entry?.state === 'error' && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/40 rounded-lg px-3 py-2" data-stat-error="">
            <span>{entry.error ?? 'Could not save.'}</span>
            <button type="button" onClick={onRetry} className="underline min-h-[44px]">Retry</button>
          </div>
        )}
        <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1">
          {schema.fields.map(f => (
            <div key={f.key} className="shrink-0 flex flex-col items-center gap-1" data-stat-field={f.key}>
              <span className="text-[11px] font-semibold text-muted uppercase tracking-wide" title={f.label}>{f.shortLabel}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => bump(f.key, -1)} disabled={!can(f.key, -1)} className={CHIP} aria-label={`${f.label} minus one`} data-stat-minus={f.key}>−</button>
                <span className="min-w-[36px] text-center text-lg font-bold tabular-nums text-primary" data-stat-value={f.key}>{stats[f.key] ?? 0}</span>
                <button type="button" onClick={() => bump(f.key, 1)} disabled={!can(f.key, 1)} className={CHIP} aria-label={`${f.label} plus one`} data-stat-plus={f.key}>+</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
