'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import type { TaggedGameView } from '@/lib/videos/video-tagged-server';

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

/**
 * "Tagged in" on a profile's Videos tab (Sprint 3 PR 7): the games a club,
 * a league or a creator tagged this athlete in — the athlete did nothing.
 * Each card links back to the full game, says how many clips they are in
 * and shows their line for the game (held back where the game is still
 * spoiler-free for this viewer). The athlete, or their guardian, can
 * remove themselves from a game here. Nothing is shown when there is none.
 */
function dayText(day: string | null): string | null {
  if (!day) return null;
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function TaggedGames({ profileId }: { profileId: string }) {
  const [games, setGames] = useState<TaggedGameView[] | null>(null);
  const [canRemove, setCanRemove] = useState(false);
  const { showUndo } = useToast();
  const [error, setError] = useState<string | null>(null);

  const fetchGames = useCallback(async (): Promise<{ games: TaggedGameView[]; canRemove: boolean }> => {
    try {
      const res = await fetch(`/api/videos/tagged?profileId=${encodeURIComponent(profileId)}`, { cache: 'no-store' });
      if (!res.ok) return { games: [], canRemove: false };
      const body = (await res.json()) as { games?: TaggedGameView[]; can_remove?: boolean };
      return { games: body.games ?? [], canRemove: body.can_remove === true };
    } catch {
      return { games: [], canRemove: false };
    }
  }, [profileId]);

  useEffect(() => {
    let live = true;
    void fetchGames().then(next => { if (live) { setGames(next.games); setCanRemove(next.canRemove); } });
    return () => { live = false; };
  }, [fetchGames]);

  // Round 2 PR 5: a removal is reversible for ten minutes, so it is done at once and offers Undo — no confirm for a reversible act.
  const remove = async (target: TaggedGameView) => {
    setError(null);
    try {
      const path = `/api/videos/${encodeURIComponent(target.video.id)}/tags`;
      const res = await fetch(`${path}?profileId=${encodeURIComponent(profileId)}`, { method: 'DELETE' });
      if (!res.ok) { setError('Could not remove the tags. Try again.'); return; }
      const body = (await res.json().catch(() => ({}))) as { ids?: string[] };
      setGames(prev => (prev ?? []).filter(g => g.video.id !== target.video.id));
      const ids = body.ids ?? [];
      if (ids.length === 0) return;
      showUndo('Tags removed', () => {
        void (async () => {
          try {
            const back = await fetch(`${path}/restore?profileId=${encodeURIComponent(profileId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
            if (!back.ok) { setError('Could not put the tags back. Try again.'); return; }
            const next = await fetchGames();
            setGames(next.games);
            setCanRemove(next.canRemove);
          } catch {
            setError('Could not put the tags back. Check your connection and try again.');
          }
        })();
      }, `The clips and stats from "${target.game_title ?? target.video.title}" left this profile.`);
    } catch {
      setError('Could not remove the tags. Check your connection and try again.');
    }
  };

  if (!games || games.length === 0) return error ? <p className="mt-4 text-sm text-red-600" role="alert">{error}</p> : null;

  return (
    <section className="mt-8" aria-labelledby="tagged-games-heading" data-tagged-games={games.length}>
      <h3 id="tagged-games-heading" className="text-lg font-bold text-primary">Tagged in</h3>
      <p className="text-sm text-secondary mb-3">Games a club, a league or a creator tagged {canRemove ? 'you' : 'this athlete'} in — clips and stats from their video.</p>
      {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}
      <ul className="space-y-3">
        {games.map(g => (
          <li key={g.video.id} className="rounded-lg border border-border bg-surface p-3" data-tagged-game={g.video.id}>
            <div className="flex gap-3">
              <Link href={`/videos/${g.video.id}`} className="ea-interactive relative block w-28 shrink-0 overflow-hidden rounded-lg bg-surface-muted aspect-video" aria-label={`Open ${g.game_title ?? g.video.title}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- a third-party thumbnail; not an optimizer candidate */}
                <img src={g.video.thumb_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
              </Link>
              <div className="min-w-0 flex-1">
                <Link href={`/videos/${g.video.id}`} className="block text-sm font-bold text-primary break-words hover:underline" data-tagged-game-title="">{g.game_title ?? g.video.title}</Link>
                <p className="text-xs text-muted truncate">{[g.video.owner.name, dayText(g.played_on)].filter(Boolean).join(' · ')}</p>
                <p className="mt-1 text-sm text-secondary" data-tagged-game-clips={g.clips}>{g.clips} {g.clips === 1 ? 'clip' : 'clips'}</p>
              </div>
            </div>
            {g.line && (
              <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1" data-tagged-game-line="">
                {g.line.map(c => (
                  <div key={c.label} className="text-center">
                    <dd className="font-mono text-base font-bold text-primary tabular-nums">{c.value}</dd>
                    <dt className="text-xs text-muted">{c.label}</dt>
                  </div>
                ))}
              </dl>
            )}
            {g.stats_hidden && <p className="mt-2 text-xs text-muted" data-tagged-game-hidden="">No spoilers — the stats show as you watch the game.</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/videos/${g.video.id}`} className={`${BTN} inline-flex items-center`} data-tagged-game-open="">Watch the full game</Link>
              {canRemove && <button type="button" onClick={() => void remove(g)} className={BTN} data-tagged-game-remove="">Remove me</button>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
