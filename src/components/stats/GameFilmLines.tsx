'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import type { TaggedGameView } from '@/lib/videos/video-tagged-server';
import FaIcon from '@/components/FaIcon';
import { faYoutubeBrands } from '@/lib/icons/fa/youtube-brands';

/**
 * "From game film" on the profile's Stats tab (Nov 12 2026; Tom's two
 * decisions): the athlete's line in each game a club, a league or a creator
 * tagged them in — a THIRD list, labelled apart from the athlete's own
 * posted games and from the Official lines, and **never in the season
 * totals or the tiles** (nothing here is stored; the line is derived from
 * the video's tags on the read). When the same game also has an official
 * line, BOTH show, each under its own label — the official one is the
 * record, this one is what the film's tags add up to.
 *
 * `sportKey` narrows to the sport the hub is on; null = every sport. A game
 * whose stats are still spoiler-free for this viewer says so instead of the
 * line. Renders nothing when there is nothing.
 */
function shortDay(day: string | null): string {
  if (!day) return '—';
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function GameFilmLines({ profileId, sportKey }: { profileId: string; sportKey: string | null }) {
  const [games, setGames] = useState<TaggedGameView[]>([]);

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
    void read().then(next => { if (live) setGames(next); });
    return () => { live = false; };
  }, [profileId]);

  // Only games (a plain tagged video has no line to list), in this sport when one is chosen, newest first.
  const rows = games
    .filter(g => g.sport_key !== null && (g.line !== null || g.stats_hidden) && (sportKey === null || g.sport_key === sportKey))
    .sort((a, b) => (b.played_on ?? '').localeCompare(a.played_on ?? ''));
  if (rows.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-border bg-surface p-4" aria-labelledby="game-film-heading" data-game-film-lines={rows.length}>
      <h3 id="game-film-heading" className="text-base font-bold text-primary">
        <FaIcon icon={faYoutubeBrands} className="mr-2 text-red-600" />From game film
      </h3>
      <p className="mt-1 mb-3 text-xs text-muted">
        Built from the tags on a full-game video — by the club, league or creator who posted it. Listed apart from posted games and official lines, and not counted in the season totals.
      </p>
      <ul className="divide-y divide-border-subtle">
        {rows.map(g => (
          <li key={g.video.id} className="py-3" data-game-film-row={g.video.id}>
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
          </li>
        ))}
      </ul>
    </section>
  );
}
