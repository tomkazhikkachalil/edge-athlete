'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useToast } from '@/components/Toast';
import { saveDistinctGames } from '@/lib/performance/game-distinct-client';
import { NO_SEASON, splitByOpponent, splitByPeriod, totalsOf, type ProfileGame } from '@/lib/sport-profile/rules';
import { seasonTitle, sportViewSearch } from '@/lib/sport-profile/view';
import SeasonRollups from '@/components/stats/SeasonRollups';
import { PROVENANCE_LABEL, UNCONFIRMED_LABEL, UNCONFIRMED_TITLE } from '@/lib/sports/provenance-copy';
import { getStatSchema } from '@/lib/sports/stat-schemas';
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
  profileId: string;
  /** Something the totals depend on changed (two games split, or joined again): read again. */
  onChanged: () => void;
}

// The rules read a game with its clips; the page's rows carry the count only — the splits never look at clips.
const asGame = (g: SportGameRow): ProfileGame => ({ ...g, clips: [] });
/** The season's games, newest first (the rows already say their season). */
const inSeason = (rows: readonly SportGameRow[], season: string): ProfileGame[] =>
  rows.filter(r => (r.season ?? NO_SEASON) === season).map(asGame).sort((a, b) => ((b.date ?? '') < (a.date ?? '') ? -1 : (b.date ?? '') > (a.date ?? '') ? 1 : a.key < b.key ? -1 : 1));

const SOURCE_NOTE: Record<SportGameRow['source'], string> = { official: 'Official', film: 'Game film', post: 'Posted' };

/** Level 2: one season — its tiles and totals, the splits, and the game log (every row a game). */
export default function SeasonView({ data, season, basePath, sportLabel, onShowHeld, profileId, onChanged }: Props) {
  const summary = data.seasons.find(s => s.key === season) ?? null;
  const games = useMemo(() => inSeason(data.games, season), [data.games, season]);
  const keys = useMemo(() => data.columns.map(c => c.key), [data.columns]);
  const rowOf = useMemo(() => new Map(data.games.map(g => [g.key, g])), [data.games]);
  const opponents = useMemo(() => splitByOpponent(games, keys), [games, keys]);
  const periods = useMemo(() => splitByPeriod(games, keys), [games, keys]);
  const heldHere = games.filter(g => g.held).length;
  // "These are two different games" (309) — the athlete's own word on two games joined by the date alone; the server decides who may say it.
  const { showError } = useToast();
  const [saving, setSaving] = useState(false);
  const split = async (a: string, b: string, distinct: boolean) => {
    setSaving(true);
    const saved = await saveDistinctGames(profileId, data.sport, a, b, distinct);
    setSaving(false);
    if (!saved.ok) showError(saved.error);
    else onChanged();
  };

  if (!summary) {
    return (
      <section className="space-y-4" data-sport-level="season">
        <p className="text-secondary">There is no {seasonTitle(season)} season here.</p>
        <Link href={basePath} className="ea-cta inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold text-white">See the career</Link>
      </section>
    );
  }

  const log: StatTableRow[] = games.map(g => {
    const row = rowOf.get(g.key)!;
    const same = g.sameAs ? rowOf.get(g.sameAs) : null;
    // An official line says the rung it was entered at ("League verified"), as the Stats tab's Official table did.
    const rung = g.source === 'official' && row.provenance ? (PROVENANCE_LABEL as Record<string, string>)[row.provenance] ?? null : null;
    const marks: string[] = [rung ? `${SOURCE_NOTE[g.source]} · ${rung}` : SOURCE_NOTE[g.source]];
    if (g.source === 'post' && row.result) marks.push(row.result);
    // The game that took this one's place: its own page — the official result, or the film's game level here.
    const sameHref = same ? (same.source === 'official' ? same.href : `${basePath}${sportViewSearch({ season: same.season, game: same.key })}`) : null;
    if (g.standing === 'recreational') marks.push('Recreational — shown, never counted');
    else if (row.disputed) marks.push('Not counted until the dispute is resolved');
    else if (!g.counted && same) { /* said below, with the link */ }
    else if (!g.counted && g.standing === 'verified_highlights') marks.push('Highlights only — not counted');
    else if (!g.counted && g.source === 'film' && !g.date) marks.push('No date played — not counted');
    else if (!g.counted) marks.push('Not counted');
    if (row.hidden) marks.push('Hidden from your page');
    const title = g.opponent ? `vs ${g.opponent}` : g.title;
    return {
      id: g.key,
      muted: !g.counted,
      counted: g.counted,
      lead: (
        <span className="block min-w-[9rem]">
          <span className="block"><Link href={`${basePath}${sportViewSearch({ season, game: g.key })}`} className="ea-interactive rounded underline decoration-border underline-offset-4" data-game-link={g.key}>{title}</Link></span>
          <span className="block text-xs font-normal text-muted">{[g.date ? formatDateShort(g.date) : 'No date', ...marks].join(' · ')}</span>
          {row.disputed && (
            <span className="mt-0.5 inline-block rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200" title={UNCONFIRMED_TITLE} data-stat-unconfirmed="">{UNCONFIRMED_LABEL}</span>
          )}
          {!g.counted && same && g.standing !== 'recreational' && !row.disputed && (
            <span className="block text-xs font-normal text-muted" data-stat-not-counted="">
              Not counted — the same game as{' '}
              {sameHref ? <Link href={sameHref} className="underline">{same.source === 'official' ? 'the official line' : 'the club\'s game film'}</Link> : same.source === 'official' ? 'the official line' : 'the club\'s game film'}
            </span>
          )}
          {data.can_edit && row.canSplit && g.sameAs && (
            <button type="button" disabled={saving} onClick={() => void split(g.key, g.sameAs!, true)} className="ea-interactive mt-1 block min-h-[32px] rounded text-left text-xs font-semibold text-secondary underline decoration-border underline-offset-4 disabled:opacity-60" data-stat-split="">
              These are two different games
            </button>
          )}
          {data.can_edit && g.counted && row.splitFrom && (
            <span className="mt-1 block text-xs font-normal text-muted" data-stat-split-done="">
              Counted as its own game.{' '}
              <button type="button" disabled={saving} onClick={() => void split(g.key, row.splitFrom!, false)} className="ea-interactive min-h-[32px] rounded font-semibold text-secondary underline decoration-border underline-offset-4 disabled:opacity-60" data-stat-split-undo="">Undo</button>
            </span>
          )}
        </span>
      ),
      stats: g.stats,
      instead: g.held ? 'Spoiler-free — counted in the totals, the line is not shown.' : undefined,
      door: (k: string) => ((row.statClips[k] ?? 0) > 0 ? `${basePath}${sportViewSearch({ season, game: g.key, stat: k })}` : null),
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

      {(data.sums || data.columns.length > 0) && (
      <div data-sport-season-totals="">
        <h3 className="mb-3 text-lg font-bold text-primary">{data.sums ? 'Season totals' : 'Season totals and bests'}</h3>
        <StatTable caption={`${sportLabel} ${seasonTitle(season)} totals`} leadLabel="" countLabel="GP" columns={data.columns} rows={[{ id: 'totals', lead: seasonTitle(season), count: summary.games, stats: summary.totals, door: k => (summary.bestIn[k] && data.games.some(g => g.key === summary.bestIn[k]) ? `${basePath}${sportViewSearch({ season, game: summary.bestIn[k] })}` : (summary.clips[k] ?? 0) > 0 ? `${basePath}${sportViewSearch({ season, stat: k })}` : null) }]} />
      </div>
      )}

      {data.sums && opponents.rows.length > 0 && (
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

      {data.sums && periods.length > 1 && data.period && (
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

      {/* The season's bests, from the performance record (the rollups' own reader). */}
      {getStatSchema(data.sport) && <SeasonRollups profileId={profileId} sportKey={data.sport} heroLabel={getStatSchema(data.sport)!.heroStat.label} mode="extras" scopeKey={season} />}

      <div data-sport-game-log="">
        <h3 className="mb-3 text-lg font-bold text-primary">Game log</h3>
        {games.some(g => g.source === 'official') && (
          <p className="mb-3 text-sm"><Link href="/help/verified-stats" className="text-brand-fg hover:text-brand-fg-strong" data-verified-help="">How verification works →</Link></p>
        )}
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
