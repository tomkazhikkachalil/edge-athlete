'use client';

import Link from 'next/link';
import { formatThru, formatToPar, formatPoints } from '@/lib/sport-events/leaderboard';
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
export interface BoardPick {
  participantId: string;
  profileId: string;
  name: string;
  rankLabel: string;
}

interface Props {
  data: OverallLeaderboard;
  /** The Net / Gross switch: which numbers fill the cells (the columns never change). */
  net: boolean;
  /** The whole row is the button (the bubble language): opens the player's breakdown. */
  onPick?: (pick: BoardPick) => void;
  /** Leftovers: a Stableford event — the key is points (desc), the second column the strokes. */
  stableford?: boolean;
}

const NET_REASON: Record<string, string> = { no_index: 'no index', no_rating: 'unrated', no_stroke_index: 'no SI' };

export default function OverallBoard({ data, net, onPick, stableford = false }: Props) {
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
            <th scope="col" className="px-2 py-2 font-semibold text-right">{stableford ? 'Pts' : net ? 'Net' : 'Total'}</th>
            <th scope="col" className="px-2 py-2 font-semibold text-right">{stableford ? 'Strokes' : 'To par'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r, i) => {
            const mv = formatMovement(r.movement);
            const line = data.board.cutLine;
            const firstMissed = line && r.madeCut === false && (i === 0 || rows[i - 1].madeCut !== false);
            const columns = 3 + rounds.length + (liveSeq !== null ? 2 : 0) + 2;
            const divider = firstMissed ? (
              <tr key={`cut-${r.participantId}`} data-cut-line="">
                <td colSpan={columns} className="px-2 py-2 text-xs font-semibold text-secondary bg-surface-muted">
                  Cut after round {line!.afterRound}{line!.score !== null ? ` · ${line!.score}` : ''} · {line!.madeCut} made it · {line!.missed} missed
                </td>
              </tr>
            ) : null;
            const key = stableford ? (net ? r.netPoints : r.points) : net ? r.net : r.total;
            const keyToPar = net ? r.netToPar : r.totalToPar;
            const strokes = net ? r.net : r.total;
            const tr = (
              <tr
                key={r.participantId}
                className={`border-b border-border-subtle ${onPick ? 'cursor-pointer hover:bg-surface-muted focus-visible:bg-surface-muted' : ''}`}
                data-overall-row={r.profileId}
                data-overall-rank={r.rank ?? ''}
                {...(onPick ? { role: 'button', tabIndex: 0, 'aria-haspopup': 'dialog' as const, 'aria-label': `${r.name}, ${r.rankLabel} — breakdown`, onClick: () => onPick({ participantId: r.participantId, profileId: r.profileId, name: r.name, rankLabel: r.rankLabel }), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick({ participantId: r.participantId, profileId: r.profileId, name: r.name, rankLabel: r.rankLabel }); } } } : {})}
              >
                <td className="sticky left-0 z-10 bg-surface pl-4 sm:pl-2 pr-2 py-2 font-bold text-primary">{r.rankLabel}</td>
                <td className={`px-1 py-2 text-center text-xs ${mv.direction === 'up' ? 'text-emerald-700 dark:text-emerald-300' : mv.direction === 'down' ? 'text-red-700 dark:text-red-300' : 'text-muted'}`}>
                  <span className="sr-only">{mv.label}</span>
                  <span aria-hidden="true">{mv.direction === 'up' ? `▲${r.movement}` : mv.direction === 'down' ? `▼${Math.abs(r.movement ?? 0)}` : '—'}</span>
                </td>
                <td className="sticky left-12 z-10 bg-surface px-2 py-2 text-primary whitespace-nowrap">
                  {r.handle ? <Link href={`/u/${r.handle}`} className="hover:text-brand-fg" onClick={e => e.stopPropagation()}>{r.name}</Link> : r.name}
                  {r.flight && <span className="ml-1.5 px-1.5 py-0.5 rounded-md border border-border text-[10px] text-secondary">{r.flight}</span>}
                  {r.madeCut === false && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted" data-missed-cut="">cut</span>}
                  {r.missedRounds.length > 0 && <span className="ml-1 text-[10px] uppercase tracking-wide text-muted" title={`Missed round ${r.missedRounds.join(', ')}`}>{r.missedRounds.length === 1 ? 'missed R' + r.missedRounds[0] : 'missed ' + r.missedRounds.length}</span>}
                </td>
                {rounds.map(h => {
                  const cell = r.rounds.find(c => c.roundId === h.id);
                  const v = cell && cell.played ? (stableford ? (net ? cell.netPoints : cell.points) : net ? cell.net : cell.gross) : null;
                  return <td key={h.id} className="px-2 py-2 text-right text-secondary tabular-nums">{v ?? '—'}</td>;
                })}
                {liveSeq !== null && <td className="px-2 py-2 text-right text-secondary tabular-nums">{r.today && r.today.thru > 0 ? (stableford ? formatPoints(net ? r.today.netPoints : r.today.points) : formatToPar(net ? r.today.netToPar : r.today.toPar)) : '—'}</td>}
                {liveSeq !== null && <td className="px-2 py-2 text-right text-secondary tabular-nums">{r.today ? formatThru(r.today.thru, r.today.holes) : '—'}</td>}
                <td className="px-2 py-2 text-right font-semibold text-primary tabular-nums">
                  {key ?? (net && r.netReason ? <span className="text-xs font-normal text-muted">{NET_REASON[r.netReason] ?? r.netReason}</span> : '—')}
                </td>
                <td className="px-2 py-2 text-right text-secondary tabular-nums">{stableford ? (strokes ?? '—') : formatToPar(keyToPar)}</td>
              </tr>
            );
            return divider ? [divider, tr] : [tr];
          })}
        </tbody>
      </table>
    </div>
  );
}
