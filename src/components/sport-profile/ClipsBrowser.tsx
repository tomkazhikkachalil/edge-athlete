'use client';

/**
 * Media on its own (Sprint 4 PR 5): the athlete's clips without going
 * through the stats — every film game the viewer may watch, recreational
 * included and marked — narrowed by season, game or play type. The filters
 * are the address. Every clip links back to the game and the stat it came
 * from.
 */
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { NO_SEASON, type ReelClip } from '@/lib/sport-profile/rules';
import { seasonTitle, sportViewSearch, type SportView } from '@/lib/sport-profile/view';
import { gameSheetFor } from '@/lib/videos/game-sheets';
import ClipReel from './ClipReel';
import { formatDateShort } from './format';
import type { SportProfileData } from './types';
import { useClips } from './useClips';

interface Props {
  data: SportProfileData;
  profileId: string;
  view: SportView;
  basePath: string;
  showHeld: boolean;
  eventLabel: (eventKey: string | null) => string | null;
}

const SELECT = 'min-h-[44px] w-full rounded-lg border border-border bg-surface px-3 text-base text-primary';

type Filters = Pick<SportView, 'season' | 'game' | 'event'>;

export default function ClipsBrowser({ data, profileId, view: opened, basePath, showHeld, eventLabel }: Props) {
  const router = useRouter();
  // The filters are held HERE and mirrored to the address: two changes in a row each start from the last one made,
  // not from an address the first change has not reached yet (the overlapping-saves rule).
  const [view, setView] = useState<Filters>({ season: opened.season, game: opened.game, event: opened.event });
  const latest = useRef(view);
  const film = useMemo(() => data.games.filter(g => g.source === 'film' && !g.held && g.clips > 0), [data.games]);
  const seasons = useMemo(() => [...new Set(film.map(g => g.season ?? NO_SEASON))].sort((a, b) => (a === NO_SEASON ? 1 : b === NO_SEASON ? -1 : a < b ? 1 : -1)), [film]);
  const games = useMemo(() => film.filter(g => !view.season || (g.season ?? NO_SEASON) === view.season).sort((a, b) => ((b.date ?? '') < (a.date ?? '') ? -1 : 1)), [film, view.season]);
  // The play types the sport's sheet can tag (a plain marker is not a play type).
  const events = useMemo(() => (gameSheetFor(data.sport)?.events ?? []).filter(e => e.group !== 'marker').map(e => ({ key: e.key, label: e.label })), [data.sport]);
  const reel = useClips({ profileId, sport: data.sport, season: view.season, game: view.game, event: view.event, everyFilm: true, showHeld }, true);
  const set = (patch: Partial<Filters>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setView(next);
    router.replace(`${basePath}${sportViewSearch({ tab: 'clips', ...next })}`, { scroll: false });
  };
  const rowOf = useMemo(() => new Map(data.games.map(g => [g.key, g])), [data.games]);
  const origin = (clip: ReelClip) => {
    const season = rowOf.get(clip.gameKey)?.season ?? null;
    return {
      gameHref: `${basePath}${sportViewSearch({ season, game: clip.gameKey })}`,
      stats: clip.statKeys
        .map(k => ({ key: k, label: data.columns.find(c => c.key === k)?.label ?? null }))
        .filter((s): s is { key: string; label: string } => s.label !== null)
        .map(s => ({ ...s, href: `${basePath}${sportViewSearch({ season, game: clip.gameKey, stat: s.key })}` })),
    };
  };

  return (
    <section className="space-y-6" data-sport-clips="">
      <h2 className="text-2xl font-bold text-primary">Clips</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm text-secondary">
          Season
          <select className={`mt-1 ${SELECT}`} value={view.season ?? ''} onChange={e => set({ season: e.target.value || null, game: null })} data-clips-filter="season">
            <option value="">Every season</option>
            {seasons.map(s => <option key={s} value={s}>{seasonTitle(s)}</option>)}
          </select>
        </label>
        <label className="block text-sm text-secondary">
          Game
          <select className={`mt-1 ${SELECT}`} value={view.game ?? ''} onChange={e => set({ game: e.target.value || null })} data-clips-filter="game">
            <option value="">Every game</option>
            {games.map(g => <option key={g.key} value={g.key}>{[g.opponent ? `vs ${g.opponent}` : g.title, g.date ? formatDateShort(g.date) : null, g.standing === 'recreational' ? 'Recreational' : null].filter(Boolean).join(' · ')}</option>)}
          </select>
        </label>
        <label className="block text-sm text-secondary">
          Play type
          <select className={`mt-1 ${SELECT}`} value={view.event ?? ''} onChange={e => set({ event: e.target.value || null })} data-clips-filter="event">
            <option value="">Every play</option>
            {events.map(ev => <option key={ev.key} value={ev.key}>{ev.label}</option>)}
          </select>
        </label>
      </div>

      {reel.state === 'loading' && <div className="min-h-[30vh]" aria-busy="true" />}
      {reel.state === 'error' && <p className="text-secondary" role="alert">The clips could not be loaded.</p>}
      {reel.state === 'ready' && reel.total === 0 && (
        <p className="text-secondary" data-clips-empty="">
          {film.length === 0 ? 'No clips yet. They appear here on their own when a club, a league or a creator tags this athlete in a game.' : 'No clips match these filters.'}
        </p>
      )}
      {reel.state === 'ready' && reel.total > 0 && (
        <ClipReel
          key={`${view.season ?? ''}|${view.game ?? ''}|${view.event ?? ''}`}
          heading={`${reel.total} ${reel.total === 1 ? 'clip' : 'clips'}`}
          clips={reel.clips}
          total={reel.total}
          onLoadMore={reel.more}
          eventLabel={eventLabel}
          origin={origin}
        />
      )}
    </section>
  );
}
