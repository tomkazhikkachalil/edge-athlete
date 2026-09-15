'use client';

import Link from 'next/link';
import { formatThru, formatToPar } from '@/lib/sport-events/leaderboard';
import type { OverallLeaderboard } from '@/lib/sport-events/leaderboard-server';
import { formatMovement } from '@/lib/sport-events/overall';

/**
 * The tournament's board (Events program, phase 2): Pos · Mv · Player ·
 * R1 … Rn · Today · Thru · Total · To par — the route's rows as pure props.
 * On a phone the table scrolls sideways with Pos and Player pinned; the
 * round columns are 40px numerals; the movement column carries an arrow
 * with an accessible label. A scheduled round is a header with "—" cells.
 * `data-overall-board` / `data-overall-row` are the e2e hooks.
 */
interface Props {
  data: OverallLeaderboard;
  /** The Net / Gross switch: which numbers fill the cells (the columns never change). */
  net: boolean;
}

const NET_REASON: Record<string, string> = { no_index: 'no index', no_rating: 'unrated', no_stroke_index: 'no SI' };

export default function OverallBoard({ data, net }: Props) {
  const rounds = data.rounds;
  const rows = data.board.rows;
  const liveSeq = data.board.current !== null && rounds.find(r => r.sequence === data.board.current)?.status === 'live' ? data.board.current : null;
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0" data-overall-board="">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-border">
            <th scope="col" className="sticky left-0 z-10 bg-surface pl-4 sm:pl-2 pr-2 py-2 font-semibold w-12">Pos</th>
            <th scope="col" className="px-1 py-2 font-semibold text-center w-10"><span className="sr-only">Movement</span><span aria-hidden="true">Mv</span></th>
            <th scope="col" className="sticky left-12 z-10 bg-surface px-2 py-2 font-semibold">Player</th>
            {rounds.map(r => <th key={r.id} scope="col" className="px-2 py-2 font-semibold text-right w-10" title={`Round ${r.sequence} · ${r.course_name}`}>R{r.sequence}</th>)}
            {liveSeq !== null && <th scope="col" className="px-2 py-2 font-semibold text-right">Today</th>}
            {liveSeq !== null && <th scope="col" className="px-2 py-2 font-semibold text-right">Thru</th>}
            <th scope="col" className="px-2 py-2 font-semibold text-right">{net ? 'Net' : 'Total'}</th>
            <th scope="col" className="px-2 py-2 font-semibold text-right">To par</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const mv = formatMovement(r.movement);
            const key = net ? r.net : r.total;
            const keyToPar = net ? r.netToPar : r.totalToPar;
            return (
              <tr key={r.participantId} className="border-b border-border-subtle" data-overall-row={r.profileId} data-overall-rank={r.rank ?? ''}>
                <td className="sticky left-0 z-10 bg-surface pl-4 sm:pl-2 pr-2 py-2 font-bold text-primary">{r.rankLabel}</td>
                <td className={`px-1 py-2 text-center text-xs ${mv.direction === 'up' ? 'text-emerald-700 dark:text-emerald-300' : mv.direction === 'down' ? 'text-red-700 dark:text-red-300' : 'text-muted'}`}>
                  <span className="sr-only">{mv.label}</span>
                  <span aria-hidden="true">{mv.direction === 'up' ? `▲${r.movement}` : mv.direction === 'down' ? `▼${Math.abs(r.movement ?? 0)}` : '—'}</span>
                </td>
                <td className="sticky left-12 z-10 bg-surface px-2 py-2 text-primary whitespace-nowrap">
                  {r.handle ? <Link href={`/u/${r.handle}`} className="hover:text-brand-fg">{r.name}</Link> : r.name}
                  {r.flight && <span className="ml-1.5 px-1.5 py-0.5 rounded-md border border-border text-[10px] text-secondary">{r.flight}</span>}
                  {r.missedRounds.length > 0 && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted" title={`Missed round ${r.missedRounds.join(', ')}`}>{r.missedRounds.length === 1 ? 'missed R' + r.missedRounds[0] : 'missed ' + r.missedRounds.length}</span>}
                </td>
                {rounds.map(h => {
                  const cell = r.rounds.find(c => c.roundId === h.id);
                  const v = cell && cell.played ? (net ? cell.net : cell.gross) : null;
                  return <td key={h.id} className="px-2 py-2 text-right text-secondary tabular-nums">{v ?? '—'}</td>;
                })}
                {liveSeq !== null && <td className="px-2 py-2 text-right text-secondary tabular-nums">{r.today && r.today.thru > 0 ? formatToPar(net ? r.today.netToPar : r.today.toPar) : '—'}</td>}
                {liveSeq !== null && <td className="px-2 py-2 text-right text-secondary tabular-nums">{r.today ? formatThru(r.today.thru, r.today.holes) : '—'}</td>}
                <td className="px-2 py-2 text-right font-semibold text-primary tabular-nums">
                  {key ?? (net && r.netReason ? <span className="text-xs font-normal text-muted">{NET_REASON[r.netReason] ?? r.netReason}</span> : '—')}
                </td>
                <td className="px-2 py-2 text-right text-secondary tabular-nums">{formatToPar(keyToPar)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
