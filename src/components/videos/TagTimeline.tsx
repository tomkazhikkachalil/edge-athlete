'use client';

import { formatTimestamp } from '@/lib/videos/rules';
import { gameSheetFor, sheetEvent } from '@/lib/videos/game-sheets';
import type { GameView } from '@/lib/videos/game-rules';
import type { HighlightRow } from '@/lib/videos/types';

/**
 * Every highlight on one line (Sprint 3 PR 3): a mark where each one starts
 * along the video's length — a scoring play taller and in the brand colour —
 * and a tap plays it. Needs the video's duration; without one there is
 * nothing to place the marks on. Shown to managers here; a viewer gets it
 * only once the stats are unlocked (the marks are spoilers).
 */
export default function TagTimeline({ highlights, durationMs, game, activeId, onPlay }: { highlights: HighlightRow[]; durationMs: number | null; game: GameView | null; activeId: string | null; onPlay: (h: HighlightRow) => void }) {
  if (!durationMs || durationMs <= 0 || highlights.length === 0) return null;
  const sheet = game ? gameSheetFor(game.sport_key) : null;
  return (
    <div className="bg-surface rounded-lg border border-border px-4 py-3" data-tag-timeline={highlights.length}>
      <div className="relative h-11" role="group" aria-label="Highlights along the video">
        <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-surface-muted" />
        {highlights.map(h => {
          const event = sheet ? sheetEvent(sheet, h.event_key) : null;
          const left = Math.min(100, Math.max(0, (h.start_ms / durationMs) * 100));
          const scoring = !!event?.score || !!event?.finish;
          return (
            <button
              key={h.id}
              type="button"
              onClick={() => onPlay(h)}
              title={`${formatTimestamp(h.start_ms)} · ${h.label}`}
              aria-label={`${h.label} at ${formatTimestamp(h.start_ms)}`}
              aria-pressed={activeId === h.id}
              className="absolute top-0 h-11 w-6 -translate-x-1/2 flex items-center justify-center"
              style={{ left: `${left}%` }}
              data-tag-timeline-mark={h.id}
            >
              <span className={`block w-1.5 rounded-full ${scoring ? 'h-7 bg-brand' : 'h-4 bg-border-strong'} ${activeId === h.id ? 'ring-2 ring-brand ring-offset-1 ring-offset-surface' : ''}`} />
            </button>
          );
        })}
      </div>
      <div className="flex justify-between text-xs font-mono text-muted"><span>0:00</span><span>{formatTimestamp(durationMs)}</span></div>
    </div>
  );
}
