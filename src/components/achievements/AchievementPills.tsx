'use client';

import { Medal, Trophy } from 'lucide-react';
import { tierAccent } from './tier-colors';
import type { TopPill } from '@/lib/achievements/display';

/**
 * The ONE pill treatment for real achievements outside the tab — the
 * profile header (own + visitor) and the public /u/ page. Replaces the
 * three divergent athlete_badges renderings (one of which fabricated
 * sample badges for every athlete).
 */

interface AchievementPillsProps {
  pills: TopPill[];
  /** Rendered as a single neutral chip when there are no achievements. */
  emptyLabel?: string;
}

export default function AchievementPills({ pills, emptyLabel }: AchievementPillsProps) {
  if (pills.length === 0 && !emptyLabel) return null;

  return (
    <div className="flex flex-wrap gap-2" role="list" aria-label="Achievements">
      {pills.length > 0 ? (
        pills.map(pill => {
          const accent = tierAccent(pill.tier);
          const podium = pill.tier !== null;
          return (
            <div
              key={pill.id}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${
                podium
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800'
                  : 'bg-brand-soft text-brand-fg-strong border-violet-200 dark:border-violet-800'
              }`}
              role="listitem"
              aria-label={`Achievement: ${pill.title}`}
            >
              {podium ? (
                <Medal className={`w-3.5 h-3.5 ${accent.text}`} aria-hidden="true" />
              ) : (
                <Trophy className="w-3.5 h-3.5 text-violet-400" aria-hidden="true" />
              )}
              <span className="truncate max-w-[16rem]">{pill.title}</span>
            </div>
          );
        })
      ) : (
        <div
          className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-surface-sunken text-muted border border-border"
          role="listitem"
          aria-label="No achievements yet"
        >
          {emptyLabel}
        </div>
      )}
    </div>
  );
}
