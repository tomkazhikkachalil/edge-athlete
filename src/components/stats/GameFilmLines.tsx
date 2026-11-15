'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { onStatGamesChanged, saveDistinctGames } from '@/lib/performance/game-distinct-client';
import { FILM_COPY } from '@/lib/videos/film-standing';
import type { TaggedGameView } from '@/lib/videos/video-tagged-server';
import FaIcon from '@/components/FaIcon';
import { faYoutubeBrands } from '@/lib/icons/fa/youtube-brands';

/**
 * "From game film" on the profile's Stats tab (Nov 12 2026): the athlete's
 * line in each game a club, a league or a creator tagged them in — a THIRD
 * list, labelled apart from the athlete's own posted games and from the
 * Official lines. Nothing here is stored; the line is derived from the
 * video's tags on the read.
 *
 * Nov 14 2026 (Tom): "only league and club tagged data is the only verified
 * data for stats". The list is split — VERIFIED (a club's or league's
 * video) and RECREATIONAL (anyone else's: shown, labelled, never counted).
 * A verified game that is fully tagged and dated COUNTS in the season totals
 * and the tiles — once: the one same-game rule (same-game.ts) decides, on
 * the server, and each row here says what it decided (`film` in the
 * stat-lines answer). When the same game has an official line BOTH show; the
 * official line is the one that counts.
 *
 * `sportKey` narrows to the sport the hub is on; null = every sport. A game
 * whose stats are still spoiler-free for this viewer says so instead of the
 * line. Renders nothing when there is nothing.
 */
interface FilmVerdict { videoId: string; key?: string; counted: boolean; sameAs: { source: 'official' | 'film'; href: string; key?: string; canSplit?: boolean } | null; splitFrom?: string | null; canEdit?: boolean }

function shortDay(day: string | null): string {
  if (!day) return '—';
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function GameFilmLines({ profileId, sportKey }: { profileId: string; sportKey: string | null }) {
  const [games, setGames] = useState<TaggedGameView[]>([]);
  // The totals' verdict per verified game, by video id — asked per sport, from the route that counts.
  const [verdicts, setVerdicts] = useState<Record<string, FilmVerdict>>({});
  // Bumped when a "different games" pair changes — here, or in the game log.
  const [tick, setTick] = useState(0);
  useEffect(() => onStatGamesChanged(() => setTick(t => t + 1)), []);

  useEffect(() => {
    let live = true;
    const read = async (): Promise<TaggedGameView[]> => {
      try {
        const res = await fetch(`/api/videos/tagged?profileId=${encodeURIComponent(profileId)}`, { cache: 'no-store' });
        if (!res.ok) return [];
        return ((await res.json()) as { games?: TaggedGameView[] }).games ?? [];
      } catch {
        return [];
      }
    };
    void read().then(async next => {
      if (!live) return;
      setGames(next);
      const sports = [...new Set(next.filter(g => g.standing === 'verified' && g.sport_key && g.played_on).map(g => g.sport_key as string))];
      const found: Record<string, FilmVerdict> = {};
      await Promise.all(sports.map(async sport => {
        try {
          const res = await fetch(`/api/sports/stat-lines?profileId=${encodeURIComponent(profileId)}&sport=${encodeURIComponent(sport)}`, { cache: 'no-store' });
          if (!res.ok) return;
          const body = (await res.json()) as { film?: FilmVerdict[]; canEdit?: boolean };
          for (const f of body.film ?? []) found[f.videoId] = { ...f, canEdit: !!body.canEdit };
        } catch {
          /* the rows stay unlabelled */
        }
      }));
      if (live) setVerdicts(found);
    });
    return () => { live = false; };
  }, [profileId, tick]);

  // Only games (a plain tagged video has no line to list), in this sport when one is chosen, newest first.
  const rows = games
    .filter(g => g.sport_key !== null && (g.line !== null || g.stats_hidden) && (sportKey === null || g.sport_key === sportKey))
    .sort((a, b) => (b.played_on ?? '').localeCompare(a.played_on ?? ''));
  if (rows.length === 0) return null;
  const verified = rows.filter(g => g.standing === 'verified' || g.standing === 'verified_highlights');
  const recreational = rows.filter(g => g.standing !== 'verified' && g.standing !== 'verified_highlights');

  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-4" aria-labelledby="game-film-heading" data-game-film-lines={rows.length}>
      <h3 id="game-film-heading" className="text-base font-bold text-primary">
        <FaIcon icon={faYoutubeBrands} className="mr-2 text-red-600" />From game film
      </h3>
      <p className="mt-1 mb-3 text-xs text-muted">
        {FILM_COPY.intro}
      </p>
      {([['verified', verified], ['recreational', recreational]] as const).map(([kind, list]) => list.length > 0 && (
        <div key={kind} className="mt-3 first:mt-0" data-game-film-group={kind}>
          <h4 className="text-sm font-semibold text-primary">{kind === 'verified' ? FILM_COPY.verifiedHeading : FILM_COPY.recreationalHeading}</h4>
          {kind === 'recreational' && <p className="text-xs text-muted">{FILM_COPY.recreationalNote}</p>}
          <ul className="divide-y divide-border-subtle">
            {list.map(g => (
              <li key={g.video.id} className="py-3" data-game-film-row={g.video.id} data-game-film-standing={g.standing ?? 'recreational'}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link href={`/videos/${g.video.id}`} className="min-w-0 text-sm font-semibold text-primary hover:text-brand-fg break-words" data-game-film-link="">
                    {g.game_title ?? g.video.title}
                  </Link>
                  <span className="text-xs text-muted">
                    {[shortDay(g.played_on), sportKey === null ? SPORT_REGISTRY[g.sport_key as keyof typeof SPORT_REGISTRY]?.display_name : null, g.video.owner.name].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {g.line && (
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1" data-game-film-line="">
                    {g.line.map(c => (
                      <div key={c.label} className="text-center">
                        <dd className="font-mono text-base font-bold text-primary tabular-nums">{c.value}</dd>
                        <dt className="text-xs text-muted">{c.label}</dt>
                      </div>
                    ))}
                  </dl>
                )}
                {g.stats_hidden && <p className="mt-1 text-xs text-muted" data-game-film-hidden="">No spoilers — the stats show as you watch the game.</p>}
                {g.standing === 'verified_highlights' && <p className="mt-1 text-xs text-muted" data-game-film-highlights="">{FILM_COPY.highlightsNote}</p>}
                {g.standing === 'verified' && !g.played_on && <p className="mt-1 text-xs text-muted" data-game-film-no-date="">{FILM_COPY.noDateNote}</p>}
                {g.standing === 'verified' && verdicts[g.video.id]?.counted === true && <p className="mt-1 text-xs font-semibold text-brand-fg" data-game-film-counted="yes">{FILM_COPY.countedNote}</p>}
                {g.standing === 'verified' && verdicts[g.video.id]?.counted === false && (
                  <p className="mt-1 text-xs text-muted" data-game-film-counted="no">
                    Not counted — the same game as{' '}
                    {verdicts[g.video.id].sameAs ? <Link href={verdicts[g.video.id].sameAs!.href} className="underline">{verdicts[g.video.id].sameAs!.source === 'official' ? 'the official line' : 'another game film'}</Link> : 'another record'}.
                    {verdicts[g.video.id].canEdit && g.sport_key && verdicts[g.video.id].key && verdicts[g.video.id].sameAs?.canSplit && verdicts[g.video.id].sameAs?.key && (
                      <button type="button" onClick={() => void saveDistinctGames(profileId, g.sport_key!, verdicts[g.video.id].key!, verdicts[g.video.id].sameAs!.key!, true)} className="ml-1 min-h-[32px] font-semibold underline text-secondary" data-game-film-split="">These are two different games</button>
                    )}
                  </p>
                )}
                {g.standing === 'verified' && verdicts[g.video.id]?.counted === true && verdicts[g.video.id].canEdit && g.sport_key && verdicts[g.video.id].key && verdicts[g.video.id].splitFrom && (
                  <p className="mt-1 text-xs text-muted" data-game-film-split-done="">
                    Counted as its own game.{' '}
                    <button type="button" onClick={() => void saveDistinctGames(profileId, g.sport_key!, verdicts[g.video.id].key!, verdicts[g.video.id].splitFrom!, false)} className="min-h-[32px] font-semibold underline text-secondary" data-game-film-split-undo="">Undo</button>
                  </p>
                )}
                {g.official_href && (
                  <p className="mt-2 text-xs text-secondary" data-game-film-official="">
                    This game also has an official line —{' '}
                    <Link href={g.official_href} className="font-semibold underline">open the game</Link>. The official line is the one that counts.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
