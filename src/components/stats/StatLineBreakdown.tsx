'use client';

/**
 * Full professional breakdown for a stat-line sport (hockey, basketball,
 * soccer, baseball, volleyball — and track's race log rides the same
 * endpoint). Season totals for EVERY schema field plus the game log —
 * `/api/sports/stat-lines` has computed both since the multi-sport round;
 * this is the first UI to render them. Year select via the endpoint's
 * `years` list.
 */

import Link from 'next/link';
import { UNCONFIRMED_LABEL, UNCONFIRMED_TITLE } from '@/lib/sports/provenance-copy';
import { useEffect, useRef, useState } from 'react';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { onStatGamesChanged, saveDistinctGames } from '@/lib/performance/game-distinct-client';
import SeasonRollups from './SeasonRollups';
import type { SportKey } from '@/lib/sports/SportRegistry';
import FaIcon from '@/components/FaIcon';
import { faShieldHalved } from '@/lib/icons/fa/shield-halved';

interface StatLinesResponse {
  sport: string;
  entryCount: number;
  totals: Record<string, number>;
  recentActivity: Array<{
    id: string;
    date: string | null;
    opponent: string | null;
    result: string | null;
    keyStat: string | null;
    /** Nov 14 2026: false when this is the same game as an official line or a club's / league's verified film — that one is in the totals. */
    counted?: boolean;
    sameAs?: { source: 'official' | 'film'; href: string | null; key?: string; canSplit?: boolean } | null;
    /** The game's name in the rule, and — when the athlete said it is a different game from another — that other one's. */
    key?: string;
    splitFrom?: string | null;
  }>;
  years: number[];
  /** The athlete or their guardian: may say two same-date games are different games (309). */
  canEdit?: boolean;
  /** Phase 4: org-entered lines from public competitions — labeled apart
   *  from the self-posted log. One game is counted once (same-game.ts): the
   *  totals hold every counted game, official or self-posted. */
  official?: Array<{
    contestId: string;
    date: string | null;
    competitionName: string;
    teamName: string | null;
    opponent: string | null;
    keyStat: string | null;
    provenance: string;
    href: string;
    /** R5: under an open dispute — shown as Unconfirmed. */
    disputed?: boolean;
  }>;
}

/** What took a game's place in the totals. */
const SAME_AS_WORD: Record<'official' | 'film', string> = { official: 'the official line', film: 'the club\'s game film' };

const OFFICIAL_PROVENANCE_LABELS: Record<string, string> = {
  sanctioned: 'Sanctioned',
  league_verified: 'League verified',
  club_recorded: 'Club recorded',
  imported: 'Imported',
  entered: 'Self reported',
};

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export default function StatLineBreakdown({
  profileId,
  sportKey,
}: {
  profileId: string;
  sportKey: SportKey;
}) {
  const [data, setData] = useState<StatLinesResponse | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSeqRef = useRef(0);
  const schema = getStatSchema(sportKey);
  // Bumped when a "different games" pair changes — here, or in the game-film list.
  const [tick, setTick] = useState(0);
  const [splitError, setSplitError] = useState<string | null>(null);
  useEffect(() => onStatGamesChanged(() => setTick(t => t + 1)), []);
  const split = async (a: string, b: string, distinct: boolean) => {
    setSplitError(null);
    const saved = await saveDistinctGames(profileId, sportKey, a, b, distinct);
    if (!saved.ok) setSplitError(saved.error);
  };

  useEffect(() => {
    const run = async () => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({ profileId, sport: sportKey });
        if (year !== null) params.set('year', String(year));
        const res = await fetch(`/api/sports/stat-lines?${params}`);
        const body = res.ok ? await res.json() : null;
        if (seq !== requestSeqRef.current) return;
        setData(body);
      } catch {
        if (seq !== requestSeqRef.current) return;
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    };
    run();
  }, [profileId, sportKey, year, tick]);

  if (!schema) return null;
  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand"></div>
      </div>
    );
  }
  const official = data?.official ?? [];
  if (!data || (data.entryCount === 0 && official.length === 0)) {
    return (
      <p className="text-sm text-muted py-2">
        No {schema.activityNoun.toLowerCase()}s logged{year !== null ? ` in ${year}` : ''} yet.
      </p>
    );
  }

  const isTrack = sportKey === 'track_field';
  // For times, a summed total is meaningless — the PB table above carries
  // the bests, so track's season table shows entry counts per event instead.
  const totalRows = schema.fields
    .map(f => ({ field: f, total: data.totals[f.key] ?? 0 }))
    .filter(r => r.total > 0);

  return (
    <div>
      {/* Career + season rollups from athlete_performances (Round 3) — the
          layer above the log; the log below stays the record. */}
      <SeasonRollups profileId={profileId} sportKey={sportKey} heroLabel={schema.heroStat.label} />
      {/* Year select — the endpoint's real years, not a catalog. */}
      {data.years.length > 1 && (
        <div className="mb-4">
          <select
            value={year ?? ''}
            onChange={e => setYear(e.target.value === '' ? null : Number(e.target.value))}
            aria-label="Season"
            className="px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">All seasons</option>
            {data.years.map(y => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Season totals — every schema field the athlete has recorded. */}
      {!isTrack && totalRows.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 font-semibold">Season totals</th>
                <th className="py-2 text-right font-semibold">
                  {data.entryCount} {schema.activityNoun.toLowerCase()}
                  {data.entryCount !== 1 ? 's' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {totalRows.map(({ field, total }) => (
                <tr key={field.key} className="border-b border-border-subtle/60 last:border-0">
                  <td className="py-2 pr-4 text-secondary">{field.label}</td>
                  <td className="py-2 text-right font-bold text-primary tabular-nums">{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Official log (phase 4) — org-entered lines, each row naming its
          competition and carrying the ACTUAL provenance rung, linking to
          the owner's public standings (the contest backlink). */}
      {official.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 font-semibold">
                  Official{' '}
                  <Link href="/help/verified-stats" className="ml-1 font-normal normal-case tracking-normal text-brand-fg hover:text-brand-fg-strong" data-verified-help="">
                    How verification works →
                  </Link>
                </th>
                <th className="py-2 pr-4 font-semibold">Competition</th>
                <th className="py-2 pr-4 font-semibold">{schema.opponentLabel}</th>
                <th className="py-2 text-right font-semibold">Key stat</th>
              </tr>
            </thead>
            <tbody>
              {official.map(row => (
                <tr key={row.contestId} className="border-b border-border-subtle/60 last:border-0">
                  <td className="py-2 pr-4 text-secondary whitespace-nowrap">
                    {row.date ? shortDate(row.date) : '—'}
                    <span className="block text-[11px] text-brand-fg">
                      <FaIcon icon={faShieldHalved} className="mr-1" />
                      {OFFICIAL_PROVENANCE_LABELS[row.provenance] ?? row.provenance}
                    </span>
                    {row.disputed && (
                      <span
                        className="mt-0.5 inline-block rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                        title={UNCONFIRMED_TITLE}
                        data-stat-unconfirmed=""
                      >
                        {UNCONFIRMED_LABEL}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-secondary">
                    <a href={row.href} className="hover:text-brand-fg">
                      {row.competitionName}
                    </a>
                  </td>
                  <td className="py-2 pr-4 text-secondary">{row.opponent ?? '—'}</td>
                  <td className="py-2 text-right font-semibold text-primary tabular-nums">
                    {row.keyStat ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {splitError && <p className="mb-2 text-sm text-red-600" role="alert">{splitError}</p>}
      {/* Game / race log. */}
      {data.recentActivity.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 font-semibold">Date</th>
                <th className="py-2 pr-4 font-semibold">{schema.opponentLabel}</th>
                <th className="py-2 pr-4 font-semibold">Result</th>
                <th className="py-2 text-right font-semibold">Key stat</th>
              </tr>
            </thead>
            <tbody>
              {data.recentActivity.map(row => (
                <tr key={row.id} className="border-b border-border-subtle/60 last:border-0" data-stat-log-row={row.id} data-stat-counted={row.counted === false ? 'no' : 'yes'}>
                  <td className="py-2 pr-4 text-secondary whitespace-nowrap">
                    {row.date ? shortDate(row.date) : '—'}
                    {row.counted === false && (
                      <span className="block whitespace-normal text-[11px] text-muted" data-stat-not-counted="">
                        Not counted — the same game as{' '}
                        {row.sameAs?.href ? <a href={row.sameAs.href} className="underline">{SAME_AS_WORD[row.sameAs.source]}</a> : SAME_AS_WORD[row.sameAs?.source ?? 'official']}
                        {data.canEdit && row.key && row.sameAs?.canSplit && row.sameAs.key && (
                          <button type="button" onClick={() => split(row.key!, row.sameAs!.key!, true)} className="mt-1 block min-h-[32px] font-semibold underline text-secondary" data-stat-split="">
                            These are two different games
                          </button>
                        )}
                      </span>
                    )}
                    {row.counted !== false && data.canEdit && row.key && row.splitFrom && (
                      <span className="block whitespace-normal text-[11px] text-muted" data-stat-split-done="">
                        Counted as its own game.{' '}
                        <button type="button" onClick={() => split(row.key!, row.splitFrom!, false)} className="min-h-[32px] font-semibold underline text-secondary" data-stat-split-undo="">Undo</button>
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-secondary">{row.opponent ?? '—'}</td>
                  <td className="py-2 pr-4 text-secondary">{row.result ?? '—'}</td>
                  <td className="py-2 text-right font-semibold text-primary tabular-nums">
                    {row.keyStat ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
