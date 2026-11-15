'use client';

import Link from 'next/link';
import { seasonTitle, sportViewSearch } from '@/lib/sport-profile/view';
import { recapPath } from '@/lib/videos/game-view';
import ClipReel from './ClipReel';
import { formatDateShort } from './format';
import StatTable from './StatTable';
import type { SportGameRow, SportProfileData } from './types';
import { useClips } from './useClips';
import { useFilmHide } from './useFilmHide';

interface Props {
  data: SportProfileData;
  profileId: string;
  season: string | null;
  gameKey: string;
  /** The stat whose clips are open (`&stat=`), or null: every clip of the game. */
  stat: string | null;
  basePath: string;
  sportLabel: string;
  showHeld: boolean;
  onShowHeld: () => void;
  eventLabel: (eventKey: string | null) => string | null;
  /** Bumped after a hide; and the way to say something changed. */
  rev: number;
  onChanged: () => void;
}

const SOURCE: Record<SportGameRow['source'], string> = { official: 'Official line', film: 'Game film', post: 'Posted by the athlete' };

/** Level 3: one game — the athlete's line (every number a door), by period, their clips, and the way to the full game. */
export default function GameView({ data, profileId, season, gameKey, stat, basePath, sportLabel, showHeld, onShowHeld, eventLabel, rev, onChanged }: Props) {
  const game = data.games.find(g => g.key === gameKey) ?? null;
  const film = game?.film ? data.games.find(g => g.key === game.film) ?? null : null;
  const reel = useClips({ profileId, sport: data.sport, game: gameKey, stat, showHeld, rev }, !!game && !!film && !film.held);
  const hide = useFilmHide(profileId, onChanged);
  const up = `${basePath}${sportViewSearch({ season })}`;
  const here = (s: string | null) => `${basePath}${sportViewSearch({ season, game: gameKey, stat: s })}`;

  if (!game) {
    return (
      <section className="space-y-4" data-sport-level="game">
        <p className="text-secondary">That game is not on this profile.</p>
        <Link href={up} className="ea-cta inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold text-white">Back to {season ? `the ${seasonTitle(season)} season` : 'the career'}</Link>
      </section>
    );
  }
  const title = game.opponent ? `vs ${game.opponent}` : game.title;
  const column = stat ? data.columns.find(c => c.key === stat) : null;
  const periods = Object.entries(game.byPeriod).map(([p, stats]) => ({ period: Number(p), stats })).sort((a, b) => a.period - b.period);

  return (
    <section className="space-y-8" data-sport-level="game" data-game={gameKey}>
      <div className="space-y-2">
        <nav aria-label="Level" className="text-sm text-secondary">
          <Link href={basePath} className="ea-interactive rounded underline decoration-border underline-offset-4" data-level-up="career">Career</Link>
          {season && (
            <>
              <span aria-hidden="true"> / </span>
              <Link href={up} className="ea-interactive rounded underline decoration-border underline-offset-4" data-level-up="season">{seasonTitle(season)}</Link>
            </>
          )}
          <span aria-hidden="true"> / </span>
          <span className="font-medium text-primary">{title}</span>
        </nav>
        <h2 className="text-2xl font-bold text-primary">{title}</h2>
        <p className="text-sm text-secondary">
          {[game.date ? formatDateShort(game.date) : 'No date', game.title !== title ? game.title : null, SOURCE[game.source], game.standing === 'recreational' ? 'Recreational — shown, never counted' : null, !game.counted && game.standing !== 'recreational' ? 'Not counted in the totals' : null].filter(Boolean).join(' · ')}
        </p>
      </div>

      {game.held ? (
        <p className="flex flex-wrap items-center gap-3 text-secondary" data-sport-held="">
          <span>This game is spoiler-free: it is counted in the totals, its line and clips are kept back.</span>
          <button type="button" onClick={onShowHeld} className="ea-interactive rounded px-2 py-1 font-medium text-primary underline decoration-border underline-offset-4" data-show-held="">Show the results</button>
        </p>
      ) : (
        <div data-game-line="">
          <h3 className="mb-3 text-lg font-bold text-primary">{sportLabel} line</h3>
          <StatTable
            caption={`The athlete's line, ${title}`}
            leadLabel=""
            columns={data.columns}
            rows={[
              { id: 'line', lead: 'Game', stats: game.stats, door: k => ((game.statClips[k] ?? 0) > 0 ? here(k) : null) },
              ...(periods.length > 1 && data.period ? periods.map(p => ({ id: `p:${p.period}`, lead: `${data.period!.short}${p.period}`, stats: p.stats, muted: true })) : []),
            ]}
          />
          {film && film.key !== game.key && <p className="mt-2 text-xs text-muted">The numbers are the {SOURCE[game.source].toLowerCase()}; the clips are the game film of the same game.</p>}
        </div>
      )}

      {!game.held && (
        film && !film.held ? (
          <div data-game-clips="">
            {reel.state === 'loading' && <div className="min-h-[30vh]" aria-busy="true" />}
            {reel.state === 'error' && <p className="text-secondary" role="alert">The clips could not be loaded.</p>}
            {reel.state === 'ready' && (
              <ClipReel
                key={`${gameKey}|${stat ?? ''}`}
                heading={column ? `${column.label} — the clips` : 'Clips from this game'}
                clips={reel.clips}
                total={reel.total}
                onLoadMore={reel.more}
                closeHref={stat ? here(null) : undefined}
                eventLabel={eventLabel}
                manage={data.can_edit ? { busy: hide.busy, setHidden: (c, hidden) => void hide.setHidden({ videoId: c.videoId, highlightId: c.id, hidden }) } : undefined}
              />
            )}
          </div>
        ) : (
          <p className="text-secondary" data-game-no-film="">{film ? 'The film of this game is spoiler-free.' : 'There is no game film of this game, so there are no clips.'}</p>
        )
      )}

      {/* The athlete's own page (311): the whole game off it — the stat still counts; "Remove me" on the game's page is the stronger door. */}
      {data.can_edit && film?.videoId && (
        <div className="space-y-2 rounded-lg border border-border-subtle p-3" data-game-hide="">
          <p className="text-sm text-secondary" data-game-hidden={film.hidden ? 'yes' : 'no'}>
            {film.hidden
              ? 'This game is hidden from your page: visitors do not see it in your game log or your clips. Its stats still count in your totals.'
              : 'You can hide this game from your page. Visitors will not see it in your game log or your clips; its stats still count in your totals.'}
          </p>
          <button type="button" disabled={hide.busy} onClick={() => void hide.setHidden({ videoId: film.videoId!, hidden: !film.hidden })} className="ea-interactive min-h-[44px] rounded-lg border border-border bg-surface px-4 text-sm font-medium text-primary disabled:opacity-60" data-game-hide-toggle="">
            {film.hidden ? 'Show this game on my page' : 'Hide this game from my page'}
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {film?.videoId && <Link href={`/videos/${film.videoId}`} className="ea-cta inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold text-white" data-game-full="">Watch the full game</Link>}
        {film?.videoId && <Link href={recapPath(film.videoId)} className="ea-interactive inline-flex min-h-[44px] items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-primary" data-game-recap="">Game recap</Link>}
        {game.source === 'official' && game.href && <Link href={game.href} className="ea-interactive inline-flex min-h-[44px] items-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-primary" data-game-official="">The official result</Link>}
      </div>
    </section>
  );
}
