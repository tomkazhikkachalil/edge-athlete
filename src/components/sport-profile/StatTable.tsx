'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { statCell } from '@/lib/sport-profile/view';
import type { StatColumn } from './types';

export interface StatTableRow {
  id: string;
  /** The first cell: a season, a game, an opponent. */
  lead: ReactNode;
  /** The second cell, when the table has one (games played). */
  count?: ReactNode;
  stats: Record<string, number>;
  /** A row that is not in the totals reads quieter. */
  muted?: boolean;
  /** A game-log row says whether it is in the totals (`data-stat-counted`). */
  counted?: boolean;
  /** Said instead of the numbers (a spoiler-free game). */
  instead?: ReactNode;
  /** A number is a door to its clips: the address of the reel behind this row's stat, or null when no clip is behind it. */
  door?: (statKey: string) => string | null;
}

interface Props {
  caption: string;
  leadLabel: string;
  countLabel?: string;
  columns: StatColumn[];
  rows: StatTableRow[];
  /** The total row, under the others. */
  foot?: StatTableRow;
}

/**
 * The one stat table of the sport profile (career by season, the splits,
 * the game log): the repo's table idiom — a horizontal scroller on a phone,
 * the first column pinned so a row keeps its name while the numbers move.
 */
export default function StatTable({ caption, leadLabel, countLabel, columns, rows, foot }: Props) {
  const line = (r: StatTableRow, strong: boolean) => (
    <tr key={r.id} className={`border-b border-border-subtle last:border-b-0 ${r.muted ? 'text-muted' : 'text-primary'}`} data-stat-row={r.id} data-stat-counted={r.counted === undefined ? undefined : r.counted ? 'yes' : 'no'}>
      <th scope="row" className={`sticky left-0 bg-surface py-2 pr-3 text-left align-top ${strong ? 'font-bold' : 'font-medium'}`}>{r.lead}</th>
      {countLabel && <td className="px-2 py-2 text-right tabular-nums">{r.count ?? ''}</td>}
      {r.instead
        ? <td colSpan={columns.length} className="px-2 py-2 text-left text-secondary">{r.instead}</td>
        : columns.map(c => {
            const href = (r.stats[c.key] ?? 0) > 0 ? r.door?.(c.key) ?? null : null;
            return (
              <td key={c.key} className={`px-2 py-2 text-right tabular-nums ${strong ? 'font-bold' : ''}`} data-stat={c.key}>
                {href ? (
                  <Link href={href} scroll={false} className="ea-interactive -mx-2 -my-1 inline-block min-w-[2.75rem] rounded px-2 py-1 text-brand underline decoration-border underline-offset-4" aria-label={`${statCell(r.stats[c.key], c.format)} ${c.label}: watch the clips`} data-stat-door={c.key}>
                    {statCell(r.stats[c.key], c.format)}
                  </Link>
                ) : statCell(r.stats[c.key] ?? 0, c.format)}
              </td>
            );
          })}
    </tr>
  );
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border-subtle text-xs uppercase tracking-wide text-muted">
            <th scope="col" className="sticky left-0 bg-surface py-2 pr-3 text-left font-medium">{leadLabel}</th>
            {countLabel && <th scope="col" className="px-2 py-2 text-right font-medium">{countLabel}</th>}
            {columns.map(c => (
              <th key={c.key} scope="col" className="px-2 py-2 text-right font-medium" title={c.label}><abbr title={`${c.label}${c.rule === 'low' || c.rule === 'high' ? ' — best' : c.rule === 'avg' ? ' — average' : ''}`} className="no-underline">{c.short}</abbr></th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(r => line(r, false))}</tbody>
        {foot && <tfoot>{line(foot, true)}</tfoot>}
      </table>
    </div>
  );
}
