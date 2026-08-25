'use client';

/**
 * The visible edit history — step back (or forward) to ANY point. One
 * component, two homes: the desktop right column renders it inline; mobile
 * wraps it in a bottom sheet. Rows are newest-first (the state you'd reach
 * next is at the top, Lightroom-style).
 */

import { historyTimeline, type History } from '@/lib/media/history';
import { labelForKeys } from '@/lib/media/history-labels';
import type { EditRecipe } from '@/lib/media/types';

interface HistoryRailProps {
  history: History<EditRecipe>;
  onJump: (index: number) => void;
}

export default function HistoryRail({ history, onJump }: HistoryRailProps) {
  const rows = historyTimeline(history);
  return (
    <ol className="flex flex-col-reverse" aria-label="Edit history">
      {rows.map(row => (
        <li key={row.index}>
          <button
            type="button"
            onClick={() => onJump(row.index)}
            aria-current={row.isPresent ? 'step' : undefined}
            className={`w-full text-left px-3 py-2 min-h-[40px] text-label rounded-lg ${
              row.isPresent
                ? 'bg-white/15 text-white font-semibold'
                : 'text-white/60 hover:text-white hover:bg-white/5'
            }`}
          >
            {labelForKeys(row.keys)}
          </button>
        </li>
      ))}
    </ol>
  );
}
