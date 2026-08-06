'use client';

import { Medal } from 'lucide-react';
import { parsePlacement, topFinishes } from '@/lib/achievements/display';
import { tierAccent } from './tier-colors';
import { formatMonthYear } from '@/lib/profile-filters';
import type { Achievement } from '@/lib/achievements';

/**
 * The showcase row: podium finishes only, best tier first. Auto-picked by
 * parsing the free-text placement — conservative, so it reorders but never
 * fabricates. Renders nothing when there are no podiums (a showcase has no
 * empty state — the PBShowcase pattern).
 */

interface TopFinishesProps {
  achievements: Achievement[];
}

export default function TopFinishes({ achievements }: TopFinishesProps) {
  const finishes = topFinishes(achievements, 4);
  if (finishes.length === 0) return null;

  return (
    <section aria-label="Top finishes">
      <h3 className="text-base font-bold text-primary mb-3">Top Finishes</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {finishes.map(a => {
          const accent = tierAccent(parsePlacement(a.placement));
          const meta = [formatMonthYear(a.achieved_on), a.organization].filter(Boolean).join(' · ');
          return (
            <div key={a.id} className="bg-surface rounded-lg border border-border p-4">
              <div className="flex items-center gap-1.5 mb-1">
                <Medal className={`w-3.5 h-3.5 ${accent.text}`} aria-hidden="true" />
                <span className="text-xs font-semibold text-muted uppercase tracking-wide truncate">
                  {a.placement}
                </span>
              </div>
              <div className="text-base font-bold text-primary leading-snug line-clamp-2">
                {a.title}
              </div>
              <div className="text-xs text-muted mt-0.5 truncate">{meta}</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
