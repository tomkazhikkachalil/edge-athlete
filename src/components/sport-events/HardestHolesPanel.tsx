'use client';

import { useState } from 'react';
import type { HardestHole } from '@/lib/golf/course-stats';
import { formatAvgOverPar } from '@/lib/sport-events/breakdown';

/**
 * The event's hardest holes (Events program, phase 2): three cells under
 * the board — the hole, its par, the average over par across every card,
 * how many cards — "Show all" expands to every qualifying hole. Nothing
 * with fewer than two cards on a hole (breakdown.ts).
 */
export default function HardestHolesPanel({ hardest }: { hardest: HardestHole[] }) {
  const [all, setAll] = useState(false);
  if (hardest.length === 0) return null;
  const shown = all ? hardest : hardest.slice(0, 3);
  return (
    <section className="space-y-2" data-hardest-holes="">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-primary">Hardest holes</h3>
        {hardest.length > 3 && (
          <button type="button" onClick={() => setAll(a => !a)} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium min-h-[44px] px-2" aria-expanded={all}>{all ? 'Show fewer' : `Show all ${hardest.length}`}</button>
        )}
      </div>
      <ul className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {shown.map(h => (
          <li key={h.hole} className="bg-surface-muted rounded-lg px-3 py-2 text-center" data-hardest-hole={h.hole}>
            <p className="text-[11px] uppercase tracking-wide text-muted">Hole {h.hole}{h.par !== null ? ` · par ${h.par}` : ''}</p>
            <p className={`text-lg font-bold tabular-nums leading-tight ${h.avgOverPar > 0 ? 'text-red-700 dark:text-red-300' : h.avgOverPar < 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-primary'}`}>{formatAvgOverPar(h.avgOverPar)}</p>
            <p className="text-xs text-secondary">{h.tracked} card{h.tracked === 1 ? '' : 's'}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
