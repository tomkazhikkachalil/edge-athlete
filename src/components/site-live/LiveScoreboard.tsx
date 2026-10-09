'use client';

// ── The live card's scoreboard — the ONE sanctioned client island on the
// public site (sports-team website program, V2; HARDENING B4.11) ──────────
// Renders exactly the server snapshot first (no hydration drift), then —
// only for a game being played or starting within two hours, on the
// viewer's clock — follows the site's live feed through the shared poller.
// No session, no storage, no third-party request: a relative same-origin
// fetch of a viewer-independent, edge-cached feed. Save-Data / reduced-data
// → no automatic requests, a Refresh button instead. Without JavaScript the
// snapshot and the card's "Follow the game →" link stand on their own.

import { useEffect, useState } from 'react';
import { gameIn, watchGame } from '@/lib/org-sites/live-poll';
import type { LiveFeedGame } from '@/lib/org-sites/live-feed';
import { prefersReducedData } from '@/lib/net/reduced-data';
import { refreshNow, subscribeFeed } from './feed-poller';

// The ONE reduced-data rule (src/lib/net/reduced-data.ts, Oct 9 2026 — the
// activity page reads it too); `autoPollAllowed` is its complement, pinned by test.
const reducedData = prefersReducedData;

function Side({ name, score, align, showScore }: { name: string; score: number | null; align: 'start' | 'end'; showScore: boolean }) {
  return (
    <div className={`min-w-0 flex-1 ${align === 'end' ? 'text-right' : ''}`}>
      <p className="break-words text-base font-bold leading-tight sm:text-lg">{name}</p>
      {showScore && score !== null && <p className="mt-1 text-3xl font-extrabold tabular-nums leading-none">{score}</p>}
    </div>
  );
}

export default function LiveScoreboard({ feedUrl, initial }: { feedUrl: string | null; initial: LiveFeedGame }) {
  const [game, setGame] = useState<LiveFeedGame>(initial);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    if (!feedUrl || !watchGame(initial, Date.now())) return;
    const auto = !reducedData();
    // Deferred a tick: the effect body never sets state synchronously (react-hooks rule).
    const t = setTimeout(() => setManual(!auto), 0);
    const off = subscribeFeed(
      feedUrl,
      feed => {
        const next = gameIn(feed, initial.id);
        if (next) setGame(next);
      },
      auto
    );
    return () => {
      clearTimeout(t);
      off();
    };
  }, [feedUrl, initial]);

  const live = game.state === 'live';
  const final = game.state === 'final';
  const showScore = live || final;
  const scoreLine = game.home && game.away && showScore && game.home.score !== null && game.away.score !== null ? `${game.home.name} ${game.home.score}, ${game.away.name} ${game.away.score}` : '';

  return (
    <div data-live-scoreboard={game.state}>
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        {live ? (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-white">Live</span>
        ) : final ? (
          <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-primary">Final</span>
        ) : (
          <span className="opacity-80">Next game</span>
        )}
      </p>
      {game.home && game.away ? (
        <div className="flex items-center gap-3">
          <Side name={game.home.name} score={game.home.score} align="start" showScore={showScore} />
          <span className="shrink-0 text-sm font-semibold uppercase tracking-wide opacity-70">vs</span>
          <Side name={game.away.name} score={game.away.score} align="end" showScore={showScore} />
        </div>
      ) : (
        <p className="break-words text-lg font-bold leading-tight">{game.title}</p>
      )}
      <p className="sr-only" aria-live="polite" data-live-score-line="">
        {scoreLine}
      </p>
      {manual && feedUrl && (
        <button type="button" onClick={() => refreshNow(feedUrl)} className="mt-3 rounded-md border border-current px-3 py-1 text-sm font-medium" data-live-refresh="">
          Refresh score
        </button>
      )}
    </div>
  );
}
