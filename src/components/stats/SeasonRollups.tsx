'use client';

/**
 * Career and season rollups from `athlete_performances` — the Stats tab's
 * second reader (Round 3, Sep 2026). Seasons are the SPORT's (a hockey
 * game in February belongs to "2025–26"); tiles are the schema's own
 * profile tiles per season; bests carry their date; the trend is the hero
 * number over the last ten events as an inline SVG (no chart dependency).
 * Renders nothing while loading or when the table has no rows for this
 * sport — the breakdown below still shows the game log.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Rollups } from '@/lib/performance/rollups';
import { onStatGamesChanged } from '@/lib/performance/game-distinct-client';
import { PROVENANCE_LABEL } from '@/lib/sports/provenance-copy';

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function Sparkline({ points, label }: { points: Array<{ date: string; value: number }>; label: string }) {
  if (points.length < 2) return null;
  const w = 240;
  const h = 48;
  const pad = 4;
  const values = points.map(p => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const y = (v: number) => h - pad - ((v - min) * (h - pad * 2)) / span;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label={`${label} over the last ${points.length} events: ${values.join(', ')}`} className="max-w-[240px]" data-rollups-trend="">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" className="text-brand" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r="3" className="fill-brand" />
    </svg>
  );
}

interface Props {
  profileId: string;
  sportKey: string;
  heroLabel: string;
  /**
   * `extras` (the sport profile, Sprint 4): only what the sport profile does
   * not already show — how verified the events are, the trend and the bests —
   * for the scope the CALLER names (`scopeKey`: a season key, or absent for
   * the career). The default is the whole block with its own scope select.
   */
  mode?: 'full' | 'extras';
  scopeKey?: string | null;
  /** The sport profile: a best is the door to the game it happened in (its address, or null when no such game is on the page). */
  bestHref?: (best: { key: string; value: number; date: string }) => string | null;
}

export default function SeasonRollups({ profileId, sportKey, heroLabel, mode = 'full', scopeKey = null, bestHref }: Props) {
  const [rollups, setRollups] = useState<Rollups | null>(null);
  const [picked, setSelected] = useState<string>('career');
  const selected = mode === 'extras' ? scopeKey ?? 'career' : picked;

  useEffect(() => {
    let cancelled = false;
    const read = async (fresh: boolean) => {
      try {
        const res = await fetch(`/api/performance/rollups?profileId=${encodeURIComponent(profileId)}&sport=${encodeURIComponent(sportKey)}`, fresh ? { cache: 'no-store' } : undefined);
        if (!res.ok) return;
        const body = (await res.json()) as { rollups: Rollups | null };
        if (!cancelled) setRollups(body.rollups);
      } catch { /* the rollups are a layer over the log — the log still renders */ }
    };
    void read(false);
    // "These are two different games" changes what is counted: read again, past the minute's cache.
    const off = onStatGamesChanged(() => void read(true));
    return () => { cancelled = true; off(); };
  }, [profileId, sportKey]);

  if (!rollups || rollups.events === 0) return null;

  const scope = selected === 'career' ? null : rollups.seasons.find(s => s.key === selected) ?? null;
  const tiles = scope ? scope.tiles : rollups.career.tiles;
  const bests = scope ? scope.bests : rollups.career.bests;
  const provenance = scope?.provenance ?? rollups.seasons.reduce<Record<string, number>>((acc, s) => {
    for (const [k, v] of Object.entries(s.provenance)) acc[k] = (acc[k] ?? 0) + v;
    return acc;
  }, {});
  const verified = Object.entries(provenance).filter(([k]) => k !== 'self_reported').reduce((n, [, v]) => n + v, 0);
  const events = scope ? scope.events : rollups.events;

  if (mode === 'extras') {
    // A season the record does not know (only recreational film, say) has nothing to add.
    if (selected !== 'career' && !scope) return null;
    const showTrend = !scope && rollups.trend.length >= 2;
    if (!showTrend && bests.length === 0 && verified === 0) return null;
    return (
      <section aria-label={scope ? 'Season bests' : 'Career bests and trend'} data-rollups="" data-rollups-mode="extras">
        {verified > 0 && <p className="mb-4 text-xs text-tertiary" data-rollups-verified="">{verified} of {events} {events === 1 ? 'event' : 'events'} {PROVENANCE_LABEL.club_recorded.toLowerCase()} or better</p>}
        {showTrend && (
          <div className="mb-4">
            <div className="mb-1 text-xs text-tertiary">{heroLabel}, last {rollups.trend.length} events</div>
            <Sparkline points={rollups.trend} label={heroLabel} />
          </div>
        )}
        {bests.length > 0 && (
          <div>
            <h3 className="mb-2 text-lg font-bold text-primary">{scope ? 'Season bests' : 'Career bests'}</h3>
            <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-rollups-bests="">
              {bests.map(b => {
                const href = bestHref?.(b) ?? null;
                const body = (
                  <>
                    <span className="text-secondary">{b.label}</span>
                    <span className="tabular-nums text-primary">{b.value} <span className="text-xs text-tertiary">{shortDate(b.date)}</span>{href && <span aria-hidden="true" className="ml-1 text-brand-fg">›</span>}</span>
                  </>
                );
                return (
                  <li key={b.key}>
                    {href ? (
                      <Link href={href} className="ea-interactive flex min-h-[44px] items-center justify-between gap-3 rounded" aria-label={`${b.label} ${b.value}: open that game`} data-rollups-best-door={b.key}>{body}</Link>
                    ) : (
                      <span className="flex justify-between gap-3 py-1">{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="mb-6" aria-labelledby="rollups-heading" data-rollups="">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 id="rollups-heading" className="text-base font-semibold text-primary">
          {scope ? `${scope.label} season` : 'Career'}
        </h3>
        {rollups.seasons.length > 1 && (
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            aria-label="Rollup scope"
            className="px-3 py-2 min-h-[44px] border border-border-strong rounded-lg text-sm bg-surface text-primary"
            data-rollups-scope=""
          >
            <option value="career">Career</option>
            {rollups.seasons.map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {tiles.map(t => (
          <div key={t.label} className="ea-surface rounded-lg p-3" data-rollups-tile={t.label}>
            <div className="text-2xl font-bold text-primary tabular-nums">{t.value ?? '—'}</div>
            <div className="text-xs text-tertiary mt-1">{t.label}</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-tertiary mb-4">
        {events} {events === 1 ? 'event' : 'events'}
        {scope ? ` · ${shortDate(scope.from)} – ${shortDate(scope.to)}` : rollups.career.from && rollups.career.to ? ` · ${shortDate(rollups.career.from)} – ${shortDate(rollups.career.to)}` : ''}
        {verified > 0 ? ` · ${verified} of ${events} ${PROVENANCE_LABEL.club_recorded.toLowerCase()} or better` : ''}
        {rollups.truncated ? ' · showing the most recent 2 000' : ''}
      </p>

      {!scope && rollups.trend.length >= 2 && (
        <div className="mb-4">
          <div className="text-xs text-tertiary mb-1">{heroLabel}, last {rollups.trend.length} events</div>
          <Sparkline points={rollups.trend} label={heroLabel} />
        </div>
      )}

      {bests.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-primary mb-2">{scope ? 'Season bests' : 'Career bests'}</h4>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm" data-rollups-bests="">
            {bests.map(b => (
              <li key={b.key} className="flex justify-between gap-3">
                <span className="text-secondary">{b.label}</span>
                <span className="text-primary tabular-nums">
                  {b.value} <span className="text-xs text-tertiary">{shortDate(b.date)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
