'use client';

import { Flame } from 'lucide-react';

/**
 * The streak, worn as a badge. Renders nothing at zero — the hero shows a
 * quiet nudge instead; an empty flame would read as a scold, not a streak.
 * "N-week streak" is grammatical at every count, which also retires the old
 * HeroStrip label ternary that offered the same string on both branches.
 */
export default function StreakBadge({ weeks }: { weeks: number }) {
  if (weeks <= 0) return null;
  return (
    <span className="vt-pop inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 px-3 py-1 text-xs font-bold whitespace-nowrap">
      <Flame className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
      {weeks}-week streak
    </span>
  );
}
