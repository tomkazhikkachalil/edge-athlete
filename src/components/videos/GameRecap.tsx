'use client';

import { useState } from 'react';
import GameStatsPanel from '@/components/videos/GameStatsPanel';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { gameSheetFor, sheetEvent } from '@/lib/videos/game-sheets';
import { gameTitleLine, type GameView } from '@/lib/videos/game-rules';
import { recapPath, topHighlights, type RevealMode } from '@/lib/videos/game-view';
import { formatTimestamp } from '@/lib/videos/rules';
import type { HighlightRow } from '@/lib/videos/types';
import FaIcon from '@/components/FaIcon';
import { faPlay } from '@/lib/icons/fa/play';

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

/**
 * The game recap (Sprint 3 PR 5) — the page a club or a creator shares
 * after the game: who played, when, the final score with the score by
 * period, the box scores, the team stats, the scoring summary in order, and
 * the top highlights. All of it is the tags, derived (GameStatsPanel). For a
 * viewer who has not watched it, the recap IS the spoiler — so it asks first.
 */
function dayText(day: string | null): string | null {
  if (!day) return null;
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

export default function GameRecap({ videoId, videoTitle, game, highlights, mode, highWaterMs, onUnlock, onWatch, onPlay, onPlayTag, onPlayTags, heldAhead = 0 }: {
  heldAhead?: number;
  videoId: string;
  videoTitle: string;
  game: GameView;
  highlights: HighlightRow[];
  mode: RevealMode;
  highWaterMs: number;
  onUnlock: () => void;
  /** Back to the video (optionally at a moment). */
  onWatch: (ms?: number) => void;
  onPlay: (h: HighlightRow) => void;
  onPlayTag?: (tagId: string) => void;
  onPlayTags?: (tagIds: string[]) => void;
}) {
  const [shared, setShared] = useState<'idle' | 'copied' | 'failed'>('idle');
  const sheet = gameSheetFor(game.sport_key);
  const top = mode === 'all' ? topHighlights(sheet, highlights) : [];

  const share = async () => {
    const url = `${window.location.origin}${recapPath(videoId)}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${gameTitleLine(game)} — recap`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared('copied');
    } catch (e) {
      // The share sheet closed by the person is not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setShared('failed');
    }
  };

  return (
    <div className="space-y-4" data-game-recap={mode}>
      <div className="bg-surface rounded-lg border border-border p-4 sm:p-6 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Game recap</p>
        <h2 className="text-2xl font-bold text-primary break-words" data-game-recap-title="">{gameTitleLine(game)}</h2>
        <p className="text-sm text-secondary">
          {[SPORT_REGISTRY[game.sport_key as keyof typeof SPORT_REGISTRY]?.display_name, dayText(game.played_on), videoTitle].filter(Boolean).join(' · ')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => onWatch()} className="ea-cta px-4 min-h-[44px] rounded-lg text-sm font-semibold text-white" data-game-recap-watch="">Watch the game</button>
          <button type="button" onClick={() => void share()} className={BTN} data-game-recap-share="">Share the recap</button>
        </div>
        {shared === 'copied' && <p className="text-sm text-secondary" role="status" data-game-recap-shared="">Link copied.</p>}
        {shared === 'failed' && <p className="text-sm text-red-600" role="alert">Could not share — copy the address from the browser instead.</p>}
        {mode === 'progressive' && (
          <p className="text-sm text-secondary" role="status" data-game-recap-gate="">
            The recap shows the final score. Watch the game first — or use <span className="font-semibold">Show full stats</span> below to see it now.
          </p>
        )}
      </div>

      <GameStatsPanel heldAhead={heldAhead} game={game} highlights={highlights} mode={mode} highWaterMs={highWaterMs} onUnlock={onUnlock} onSeek={ms => onWatch(ms)} onPlayTag={onPlayTag} onPlayTags={onPlayTags} />

      {top.length > 0 && (
        <section className="bg-surface rounded-lg border border-border p-4 sm:p-6" aria-labelledby="recap-top-heading" data-game-recap-top={top.length}>
          <h2 id="recap-top-heading" className="text-lg font-bold text-primary mb-2">Top highlights</h2>
          <ol className="divide-y divide-border-subtle">
            {top.map(h => {
              const event = sheet ? sheetEvent(sheet, h.event_key) : null;
              return (
                <li key={h.id}>
                  <button type="button" onClick={() => onPlay(h)} className="ea-interactive flex w-full items-center gap-3 px-1 min-h-[48px] text-left" data-game-recap-highlight={h.id}>
                    <span className="font-mono text-sm text-brand-fg shrink-0 w-16">{formatTimestamp(h.start_ms)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-primary truncate">
                        {event && <span className="mr-2 inline-block rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-secondary align-middle">{event.short}</span>}
                        {h.label}
                      </span>
                      {h.people.length > 0 && <span className="block text-xs text-muted truncate">{h.people.map(p => p.name).join(', ')}</span>}
                    </span>
                    <FaIcon icon={faPlay} className="text-xs text-muted shrink-0" />
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
