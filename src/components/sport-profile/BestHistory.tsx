'use client';

/**
 * A best's own history ("one wave", phase 4): every race of one event — or
 * every run's pace — newest first, with the ones that were a best at the
 * time marked. The pivot a track athlete thinks in: "my 100 m". Each row is
 * the door to its race. It sits above the level it was opened from, like a
 * stat's reel, and closes back to it.
 */
import Link from 'next/link';
import { progressionOf } from '@/lib/sport-profile/rules';
import { seasonTitle, sportViewSearch, statCell } from '@/lib/sport-profile/view';
import type { SportProfileData } from './types';

interface Props { data: SportProfileData; season: string | null; stat: string; basePath: string }

const day = (date: string | null) => (date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'No date');

export default function BestHistory({ data, season, stat, basePath }: Props) {
  const column = data.columns.find(c => c.key === stat);
  if (!column) return null;
  // What a best was at the time is judged over the whole career; a season then shows its own rows.
  const all = progressionOf(data.games, stat, column.rule);
  const gameOf = new Map(data.games.map(g => [g.key, g]));
  const points = season ? all.filter(p => (gameOf.get(p.key)?.season ?? 'undated') === season) : all;
  return (
    <div className="mb-8 border-b border-border-subtle pb-8" data-best-history={stat}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-primary">{column.label} — {season ? seasonTitle(season) : 'career'}</h2>
        <Link href={`${basePath}${sportViewSearch({ season })}`} scroll={false} className="ea-interactive inline-flex min-h-[44px] items-center rounded-lg border border-border px-4 text-sm font-medium text-primary" data-best-history-close="">Close</Link>
      </div>
      {points.length === 0 ? (
        <p className="text-sm text-muted">Nothing recorded here yet.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {points.map(p => {
            const g = gameOf.get(p.key)!;
            return (
              <li key={p.key}>
                <Link href={`${basePath}${sportViewSearch({ season: g.season ?? 'undated', game: g.key })}`} className="ea-interactive flex min-h-[52px] items-center justify-between gap-3 rounded px-1" data-best-history-row={p.key}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-primary">{g.title}</span>
                    <span className="block text-xs text-muted">{day(p.date)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {p.record && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/60 dark:text-amber-300" data-best-history-record="">Best at the time</span>}
                    <span className="text-lg font-bold tabular-nums text-primary">{statCell(p.value, column.format)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
