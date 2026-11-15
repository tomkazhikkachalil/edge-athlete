'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { NO_SEASON, splitByOpponent, splitByPeriod, totalsOf, type ProfileGame } from '@/lib/sport-profile/rules';
import { seasonTitle } from '@/lib/sport-profile/view';
import { formatDateShort } from './format';
import StatTable, { type StatTableRow } from './StatTable';
import Tiles from './Tiles';
import type { SportGameRow, SportProfileData } from './types';

interface Props {
  data: SportProfileData;
  season: string;
  basePath: string;
  sportLabel: string;
  /** The viewer asks to see the spoiler-free games of this profile. */
  onShowHeld: () => void;
}

// The rules read a game with its clips; the page's rows carry the count only — the splits never look at clips.
const asGame = (g: SportGameRow): ProfileGame => ({ ...g, clips: [] });
/** The season's games, newest first (the rows already say their season). */
const inSeason = (rows: readonly SportGameRow[], season: string): ProfileGame[] =>
  rows.filter(r => (r.season ?? NO_SEASON) === season).map(asGame).sort((a, b) => ((b.date ?? '') < (a.date ?? '') ? -1 : (b.date ?? '') > (a.date ?? '') ? 1 : a.key < b.key ? -1 : 1));

const SOURCE_NOTE: Record<SportGameRow['source'], string> = { official: 'Official', film: 'Game film', post: 'Posted' };

/** Level 2: one season — its tiles and totals, the splits, and the game log (every row a game). */
export default function SeasonView({ data, season, basePath, sportLabel, onShowHeld }: Props) {
  const summary = data.seasons.find(s => s.key === season) ?? null;
  const games = useMemo(() => inSeason(data.games, season), [data.games, season]);
  const keys = useMemo(() => data.columns.map(c => c.key), [data.columns]);
  const rowOf = useMemo(() => new Map(data.games.map(g => [g.key, g])), [data.games]);
  const opponents = useMemo(() => splitByOpponent(games, keys), [games, keys]);
  const periods = useMemo(() => splitByPeriod(games, keys), [games, keys]);
  const heldHere = games.filter(g => g.held).length;

  if (!summary) {
    return (
      <section className="space-y-4" data-sport-level="season">
        <p className="text-secondary">There is no {seasonTitle(season)} season here.</p>
        <Link href={basePath} className="ea-cta inline-flex">See the career</Link>
      </section>
    );
  }

  const log: StatTableRow[] = games.map(g => {
    const row = rowOf.get(g.key)!;
    const same = g.sameAs ? rowOf.get(g.sameAs) : null;
    const marks: string[] = [SOURCE_NOTE[g.source]];
    if (g.standing === 'recreational') marks.push('Recreational — shown, never counted');
    else if (!g.counted && same) marks.push(`Not counted — the same game as the ${same.source === 'official' ? 'official line' : 'game film'}`);
    else if (!g.counted && g.standing === 'verified_highlights') marks.push('Highlights only — not counted');
    else if (!g.counted && g.source === 'film' && !g.date) marks.push('No date played — not counted');
    else if (!g.counted) marks.push('Not counted');
    const title = g.opponent ? `vs ${g.opponent}` : g.title;
    return {
      id: g.key,
      muted: !g.counted,
      lead: (
        <span className="block min-w-[9rem]">
          <span className="block">{row.href ? <Link href={row.href} className="ea-interactive rounded underline decoration-border underline-offset-4" data-game-link={g.key}>{title}</Link> : title}</span>
          <span className="block text-xs font-normal text-muted">{[g.date ? formatDateShort(g.date) : 'No date', ...marks].join(' · ')}</span>
        </span>
      ),
      stats: g.stats,
      instead: g.held ? 'Spoiler-free — counted in the totals, the line is not shown.' : undefined,
    };
  });

  return (
    <section className="space-y-8" data-sport-level="season" data-season={season}>
      <div className="space-y-3">
        <nav aria-label="Level" className="text-sm text-secondary">
          <Link href={basePath} className="ea-interactive rounded underline decoration-border underline-offset-4" data-level-up="career">Career</Link>
          <span aria-hidden="true"> / </span>
          <span className="font-medium text-primary">{seasonTitle(season)}</span>
        </nav>
        <h2 className="text-2xl font-bold text-primary">{seasonTitle(season)} season</h2>
        <Tiles tiles={summary.tiles} />
      </div>

      <div>
        <h3 className="mb-3 text-lg font-bold text-primary">Season totals</h3>
        <StatTable caption={`${sportLabel} ${seasonTitle(season)} totals`} leadLabel="" countLabel="GP" columns={data.columns} rows={[{ id: 'totals', lead: seasonTitle(season), count: summary.games, stats: summary.totals }]} />
      </div>

      {opponents.rows.length > 0 && (
        <div data-sport-split="opponent">
          <h3 className="mb-3 text-lg font-bold text-primary">By opponent</h3>
          <StatTable
            caption="Season totals by opponent"
            leadLabel="Opponent"
            countLabel="GP"
            columns={data.columns}
            rows={[
              ...opponents.rows.map(r => ({ id: `o:${r.label}`, lead: r.label, count: r.games, stats: r.totals })),
              ...(opponents.rest.games > 0 ? [{ id: 'o:rest', lead: 'Other games', count: opponents.rest.games, stats: opponents.rest.totals, muted: true }] : []),
            ]}
          />
        </div>
      )}

      {periods.length > 1 && data.period && (
        <div data-sport-split="period">
          <h3 className="mb-1 text-lg font-bold text-primary">By {data.period.noun.toLowerCase()}</h3>
          <p className="mb-3 text-sm text-muted">From game film only — an official line or a posted game has no {data.period.noun.toLowerCase()}s, so these need not add up to the season.</p>
          <StatTable
            caption={`Season totals by ${data.period.noun.toLowerCase()}`}
            leadLabel={data.period.noun}
            columns={data.columns}
            rows={periods.map(p => ({ id: `p:${p.period}`, lead: `${data.period!.short}${p.period}`, stats: p.totals }))}
          />
        </div>
      )}

      <div data-sport-game-log="">
        <h3 className="mb-3 text-lg font-bold text-primary">Game log</h3>
        {heldHere > 0 && (
          <p className="mb-3 flex flex-wrap items-center gap-3 text-sm text-secondary" data-sport-held="">
            <span>{heldHere === 1 ? 'One game is' : `${heldHere} games are`} spoiler-free: counted above, the line kept back.</span>
            <button type="button" onClick={onShowHeld} className="ea-interactive rounded px-2 py-1 font-medium text-primary underline decoration-border underline-offset-4" data-show-held="">Show the results</button>
          </p>
        )}
        <StatTable caption={`${sportLabel} ${seasonTitle(season)} game log`} leadLabel="Game" columns={data.columns} rows={log} />
        <p className="mt-3 text-xs text-muted">Season totals are {totalsOf(games, keys).games === 1 ? 'one counted game' : `${totalsOf(games, keys).games} counted games`}. One game is counted once: an official line, then a club&apos;s or league&apos;s game film, then the athlete&apos;s own post.</p>
      </div>
    </section>
  );
}
