'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EventApi } from '@/lib/sport-events/client';
import { formatThru, formatToPar } from '@/lib/sport-events/leaderboard';
import type { OverallLeaderboard, RoundLeaderboard } from '@/lib/sport-events/leaderboard-server';
import { offersOverall, type RoundSelection } from '@/lib/sport-events/tabs';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import OverallBoard from './OverallBoard';
import RoundSwitcher from './RoundSwitcher';

interface Props {
  view: SportEventViewPayload;
  api: EventApi;
  /** Bumped by the shell after any action so the board refetches. */
  version: number;
  /** Phase 2: 'overall' or a round id (the shell derives it from ?round=). */
  selected: RoundSelection | null;
  onSelect: (next: RoundSelection) => void;
}

/**
 * The leaderboard tab — the route's rows, pure props to the table; Net /
 * Gross switch on a net event. Phase 2: the round switcher on a tournament
 * ("Overall" first — the OverallBoard — then each round's own board).
 */
export default function EventLeaderboard({ view, api, version, selected, onSelect }: Props) {
  const overall = selected === 'overall';
  const round = !overall && selected ? view.rounds.find(r => r.id === selected) ?? null : null;
  const [board, setBoard] = useState<RoundLeaderboard | null>(null);
  const [overallBoard, setOverallBoard] = useState<OverallLeaderboard | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [mode, setMode] = useState<'net' | 'gross'>(view.event.format === 'stroke_net' ? 'net' : 'gross');
  const roundId = round?.id ?? null;

  useEffect(() => {
    if (!overall && !roundId) return;
    let cancelled = false;
    (async () => {
      if (overall) {
        const res = await api.overall();
        if (cancelled) return;
        if (res.ok && res.data) { setOverallBoard(res.data); setState('ready'); } else setState('error');
      } else if (roundId) {
        const res = await api.leaderboard(roundId);
        if (cancelled) return;
        if (res.ok && res.data) { setBoard(res.data); setState('ready'); } else setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [api, overall, roundId, version]);

  const switcher = <RoundSwitcher rounds={view.rounds} selected={selected} onChange={onSelect} includeOverall={offersOverall('leaderboard', view.rounds)} label="Leaderboard round" />;
  const toggle = view.event.format === 'stroke_net' && (
    <div className="flex rounded-lg border border-border-strong overflow-hidden w-fit" role="group" aria-label="Scoring">
      {(['net', 'gross'] as const).map(m => (
        <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} className={`h-10 px-4 text-sm font-medium transition ${mode === m ? 'bg-brand text-white' : 'bg-surface text-tertiary hover:text-brand-fg'}`}>
          {m === 'net' ? 'Net' : 'Gross'}
        </button>
      ))}
    </div>
  );
  const net = mode === 'net';

  if (!overall && !round) return <div className="space-y-3">{switcher}<p className="text-sm text-muted">No round yet.</p></div>;
  const current = overall ? overallBoard : board;
  if (state === 'loading' && !current) return <div className="space-y-3">{switcher}<div className="flex justify-center py-8" aria-busy="true"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand" /></div></div>;
  if (state === 'error' && !current) return <div className="space-y-3">{switcher}<p className="text-sm text-red-700 dark:text-red-300">The leaderboard could not be loaded.</p></div>;

  if (overall && overallBoard) {
    const anyScored = overallBoard.board.scoredRounds.length > 0;
    return (
      <div className="space-y-3" data-event-leaderboard="overall">
        {switcher}
        {toggle}
        {!anyScored && (
          <p className="text-sm text-muted">
            {view.event.status === 'live' ? 'No scores yet — the board fills in as players enter holes.' : view.event.status === 'completed' ? 'No scores were recorded.' : 'The board fills in once the event is live.'}
          </p>
        )}
        <OverallBoard data={overallBoard} net={net} />
      </div>
    );
  }

  const rows = board?.rows ?? [];
  const anyScored = rows.some(r => r.thru > 0);
  const holes = round!.holes;
  return (
    <div className="space-y-3" data-event-leaderboard={round!.id}>
      {switcher}
      {toggle}
      {!anyScored && (
        <p className="text-sm text-muted">
          {round!.status === 'live' ? 'No scores yet — the board fills in as players enter holes.'
            : round!.status === 'completed' ? 'No scores were recorded.'
            : view.event.status === 'live' ? 'The board fills in once the round is live.'
            : 'The board fills in once the event is live.'}
        </p>
      )}
      <div className="overflow-x-auto -mx-4 sm:mx-0">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="sticky left-0 bg-surface pl-4 sm:pl-2 pr-2 py-2 font-semibold">Pos</th>
              <th className="px-2 py-2 font-semibold">Player</th>
              <th className="px-2 py-2 font-semibold text-right">Thru</th>
              <th className="px-2 py-2 font-semibold text-right">To par</th>
              <th className="px-2 py-2 font-semibold text-right">{net ? 'Net' : 'Total'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.participantId} className="border-b border-border-subtle" data-leaderboard-row={r.profileId}>
                <td className="sticky left-0 bg-surface pl-4 sm:pl-2 pr-2 py-2 font-bold text-primary">{r.rankLabel}</td>
                <td className="px-2 py-2 text-primary whitespace-nowrap">
                  {r.handle ? <Link href={`/u/${r.handle}`} className="hover:text-brand-fg">{r.name}</Link> : r.name}
                  {r.flight && <span className="ml-1.5 px-1.5 py-0.5 rounded-md border border-border text-[10px] text-secondary">{r.flight}</span>}
                  {r.cardStatus === 'final' && <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">final</span>}
                </td>
                <td className="px-2 py-2 text-right text-secondary">{formatThru(r.thru, holes)}</td>
                <td className="px-2 py-2 text-right text-secondary">{formatToPar(net ? r.netToPar : r.toPar)}</td>
                <td className="px-2 py-2 text-right font-semibold text-primary">
                  {net ? (r.net ?? (r.netReason ? <span className="text-xs font-normal text-muted">{r.netReason === 'no_index' ? 'no index' : r.netReason === 'no_rating' ? 'unrated' : 'no SI'}</span> : '—')) : (r.gross ?? '—')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
