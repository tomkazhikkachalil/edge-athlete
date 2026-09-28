import Link from 'next/link';
import type { TeamScheduleItem } from '@/lib/teams/schedule';
import { whenOf } from '@/components/teams/TeamScheduleList';
import ScrollStrip from './ScrollStrip';

// The game-day sections — sports-team website program, G2 (Sep 28 2026).
// Props-only and server-safe (the (public) contract: no hooks, no script):
// `NextGameCard` is the next game (or the one being played) as a scoreboard
// card or a brand banner; `ResultsList` is the latest finals as a list or a
// snap-scrolling score strip. Both read the org's games bag (`fetchOrgGames`,
// home first); a game without its two sides falls back to its title line.

function Side({ name, score, align }: { name: string; score: number | null; align: 'start' | 'end' }) {
  return (
    <div className={`min-w-0 flex-1 ${align === 'end' ? 'text-right' : ''}`}>
      <p className="break-words text-base font-bold leading-tight sm:text-lg">{name}</p>
      {score !== null && <p className="mt-1 text-3xl font-extrabold tabular-nums leading-none">{score}</p>}
    </div>
  );
}

function Matchup({ game }: { game: TeamScheduleItem }) {
  if (!game.pair) return <p className="break-words text-lg font-bold leading-tight">{game.title}</p>;
  const live = game.state === 'live';
  return (
    <div className="flex items-center gap-3">
      <Side name={game.pair.home} score={live ? game.pair.homeScore : null} align="start" />
      <span className="shrink-0 text-sm font-semibold uppercase tracking-wide opacity-70">vs</span>
      <Side name={game.pair.away} score={live ? game.pair.awayScore : null} align="end" />
    </div>
  );
}

export function NextGameCard({
  game,
  variant = 'card',
  scheduleHref,
}: {
  game: TeamScheduleItem | null;
  variant?: 'card' | 'banner';
  scheduleHref: string;
}) {
  if (!game) return <p className="mt-1 text-sm text-tertiary">No games scheduled.</p>;
  const live = game.state === 'live';
  const meta = `${whenOf(game)}${game.location ? ` · ${game.location}` : ''}`;
  const banner = variant === 'banner';
  return (
    <div
      className={banner ? 'mt-2 rounded-lg bg-brand p-4 text-white sm:p-6' : 'mt-2 rounded-lg border border-border bg-surface p-4 text-primary sm:p-5'}
      data-site-next-game={game.state}
      data-variant={variant}
    >
      <p className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
        {live ? (
          <span className="rounded-full bg-red-600 px-2 py-0.5 text-white">Live</span>
        ) : (
          <span className={banner ? 'opacity-80' : 'text-secondary'}>Next game</span>
        )}
      </p>
      <Matchup game={game} />
      <p className={`mt-3 break-words text-sm ${banner ? 'opacity-90' : 'text-secondary'}`}>{meta}</p>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm font-medium">
        {game.href && (
          <a href={game.href} className={banner ? 'underline' : 'text-brand-fg'}>
            {live ? 'Follow the game →' : 'Game details →'}
          </a>
        )}
        <Link href={scheduleHref} className={banner ? 'underline' : 'text-brand-fg'}>
          Full schedule →
        </Link>
      </p>
    </div>
  );
}

function ScoreCard({ game }: { game: TeamScheduleItem }) {
  const body = (
    <>
      {game.pair && game.pair.homeScore !== null && game.pair.awayScore !== null ? (
        <div className="space-y-1">
          {[
            { name: game.pair.home, score: game.pair.homeScore, won: game.pair.homeScore > game.pair.awayScore },
            { name: game.pair.away, score: game.pair.awayScore, won: game.pair.awayScore > game.pair.homeScore },
          ].map((s, i) => (
            <p key={i} className={`flex items-baseline justify-between gap-2 text-sm ${s.won ? 'font-bold text-primary' : 'text-secondary'}`}>
              <span className="min-w-0 truncate">{s.name}</span>
              <span className="tabular-nums">{s.score}</span>
            </p>
          ))}
        </div>
      ) : (
        <p className="break-words text-sm font-semibold text-primary">{game.title}</p>
      )}
      <p className="mt-2 text-xs text-tertiary">{`Final · ${whenOf(game)}`}</p>
    </>
  );
  return game.href ? (
    <a href={game.href} className="block h-full rounded-lg border border-border bg-surface p-3 hover:border-brand-fg">
      {body}
    </a>
  ) : (
    <div className="h-full rounded-lg border border-border bg-surface p-3">{body}</div>
  );
}

export function ResultsList({
  games,
  variant = 'list',
  resultsHref,
}: {
  games: TeamScheduleItem[];
  variant?: 'list' | 'strip';
  resultsHref: string;
}) {
  if (games.length === 0) return <p className="mt-1 text-sm text-tertiary">No results yet.</p>;
  return (
    <div data-site-results-widget={variant}>
      {variant === 'strip' ? (
        <ScrollStrip label="Latest results" itemWidth="12rem" testId="results">
          {games.map(g => (
            <ScoreCard key={g.key} game={g} />
          ))}
        </ScrollStrip>
      ) : (
        <ul className="mt-2">
          {games.map(g => (
            <li key={g.key} className="border-t border-border-subtle py-2 first:border-t-0 text-sm" data-site-result-item="">
              <p className="break-words font-medium text-primary">
                {g.href ? (
                  <a href={g.href} className="hover:underline">
                    {g.title}
                  </a>
                ) : (
                  g.title
                )}
              </p>
              <p className="text-xs text-secondary">{`${whenOf(g)}${g.location ? ` · ${g.location}` : ''}`}</p>
            </li>
          ))}
        </ul>
      )}
      <Link href={resultsHref} className="mt-3 inline-block text-sm font-medium text-brand-fg">
        All results →
      </Link>
    </div>
  );
}
