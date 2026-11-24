'use client';

import { useState } from 'react';
import type { TeeTotal } from '@/lib/golf/course-summary';
import { teeDotColour, teeRowLabel } from '@/lib/golf/tees';

/**
 * The tee table (the mechanical dialect, Nov 23 2026): the round's tee
 * picker. One row per tee — a dot in the tee's colour, the name, the yards,
 * the rating / slope — each only when the course knows it (a dash
 * otherwise). A row is a button: a tap picks that tee through the SAME
 * handler the old Tees select ran (the rating, the slope and the per-hole
 * yardages re-fill); a tap on the picked row lets it go, as "Select tees"
 * did. It owns no data.
 */
interface TeeTableProps {
  tees: readonly TeeTotal[];
  value: string;
  onPick: (key: string) => void;
}

export default function TeeTable({ tees, value, onPick }: TeeTableProps) {
  const [pressed, setPressed] = useState<string | null>(null);
  const release = () => setPressed(null);
  const cols = 'grid grid-cols-[24px_minmax(0,1fr)_64px_92px] items-center px-3';

  return (
    <div className="ea-mech-panel rounded-2xl overflow-hidden" role="group" aria-label="Tees" data-tee-table="">
      <div className={`${cols} h-6`} aria-hidden="true">
        <span />
        <span className="ea-mech-micro">Tee</span>
        <span className="ea-mech-micro text-right">Yds</span>
        <span className="ea-mech-micro text-right">Rtg / Slp</span>
      </div>
      {tees.map(t => {
        const selected = t.key === value;
        const dot = teeDotColour(t.key);
        const numbers =
          t.rating !== null && t.slope !== null ? `${t.rating} / ${t.slope}`
            : t.rating !== null ? `${t.rating} / —`
              : t.slope !== null ? `— / ${t.slope}`
                : '—';
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick(selected ? '' : t.key)}
            aria-pressed={selected}
            data-tee-row={t.key}
            {...(selected ? { 'data-selected': '' } : {})}
            {...(pressed === t.key ? { 'data-pressed': '' } : {})}
            onPointerDown={() => setPressed(t.key)}
            onPointerUp={release}
            onPointerLeave={release}
            onPointerCancel={release}
            className={`ea-mech-row ${cols} w-full h-11 text-left`}
            style={{ borderTop: '1px solid var(--mech-divider)' }}
          >
            <span
              aria-hidden="true"
              className="inline-block w-3 h-3 rounded-full"
              style={{ backgroundColor: dot ?? 'transparent', border: '1px solid var(--mech-dot-ring)' }}
            />
            <span className="truncate text-sm font-semibold text-[color:var(--mech-text)]">{teeRowLabel(t.key)}</span>
            <span className="ea-mech-readout text-sm text-right">{t.yards !== null ? t.yards.toLocaleString('en-US') : '—'}</span>
            <span className="ea-mech-readout !font-medium text-xs text-right !text-[color:var(--mech-text-dim)]">{numbers}</span>
          </button>
        );
      })}
    </div>
  );
}
