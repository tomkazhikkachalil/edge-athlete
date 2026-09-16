'use client';

import Link from 'next/link';
import { useRoundStats } from '@/hooks/useRoundStats';
import type { EventApi } from '@/lib/sport-events/client';
import { scoreLabel } from '@/lib/sport-events/game';
import type { StatLineView } from '@/lib/sport-events/stats-server';
import type { RoundSelection } from '@/lib/sport-events/tabs';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import { formatDateOnly, formatTeeTime } from '@/lib/sport-events/format';

interface Props {
  view: SportEventViewPayload;
  api: EventApi;
  /** Bumped by the shell after any action so the board refetches. */
  version: number;
  selected: RoundSelection | null;
  onSelect: (next: RoundSelection) => void;
}

/**
 * The Stats tab of a team event (Events program, phase 4): the round's
 * live score (a game) and every player's line, side by side — polled 5 s
 * while the round is live (posture-A tables emit no realtime), 30 s
 * otherwise. Read-only here; entry is the live screen (`/events/[id]/live`).
 */
export default function EventStatsTab({ view, api, version, selected, onSelect }: Props) {
  const rounds = view.rounds.filter(r => r.status !== 'cancelled');
  const picked = selected && selected !== 'overall' && selected !== 'bracket' ? rounds.find(r => r.id === selected) ?? null : null;
  const round = picked ?? rounds.find(r => r.status === 'live') ?? rounds.find(r => r.status === 'scheduled') ?? rounds[rounds.length - 1] ?? null;
  const roundId = round?.id ?? null;
  const live = round?.status === 'live';
  const { data: payload, state } = useRoundStats(api, roundId, live);
  // The shell bumps `version` after an action; the poll carries it anyway.
  void version;

  if (!round) return <p className="text-sm text-muted">No round yet.</p>;
  const sides = payload?.sides ?? null;
  const fields = payload?.fields ?? [];
  const lines = payload?.lines ?? [];
  const bySide = (side: 1 | 2 | null) => lines.filter(l => l.side === side);

  const table = (rows: StatLineView[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 pr-2 font-medium">Player</th>
            {fields.map(f => <th key={f.key} className="py-1 px-1 text-right font-medium" title={f.label}>{f.shortLabel}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(l => (
            <tr key={l.id} className="border-t border-border-subtle" data-event-stat-line={l.participant_id}>
              <td className="py-2 pr-2 min-w-0">
                <span className="block font-semibold text-primary truncate">{l.name}</span>
                {l.headline && <span className="block text-xs text-muted" data-event-stat-headline="">{l.headline}</span>}
              </td>
              {fields.map(f => <td key={f.key} className="py-2 px-1 text-right tabular-nums text-primary" data-event-stat-cell={`${l.participant_id}:${f.key}`}>{l.stats[f.key] ?? 0}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-4" data-event-stats-board="">
      {rounds.length > 1 && (
        <label className="block">
          <span className="sr-only">Round</span>
          <select value={round.id} onChange={e => onSelect(e.target.value)} className="min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-sm" data-event-stats-round="">
            {rounds.map(r => <option key={r.id} value={r.id}>{r.name?.trim() || `Round ${r.sequence}`} · {formatDateOnly(r.scheduled_on)}</option>)}
          </select>
        </label>
      )}
      <p className="text-xs text-muted">{round.course_name}{round.starts_at ? ` · ${formatTeeTime(round.starts_at)}` : ''}{live ? ' · live' : round.status === 'completed' ? ' · final' : ''}</p>
      {payload && sides && (
        <p className="text-lg font-bold text-primary" data-event-score-line="">{scoreLabel(payload.round.score, sides)}</p>
      )}
      {payload && (live || payload.viewer.can_enter === 'all') && round.status !== 'completed' && (
        <Link href={`/events/${view.event.id}/live?round=${round.id}`} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center" data-event-live-open="">
          <i className="fas fa-broadcast-tower mr-2" aria-hidden="true"></i>{payload.viewer.can_enter === 'all' || payload.viewer.can_enter.length > 0 ? 'Enter stats live' : 'Watch live'}
        </Link>
      )}
      {state === 'error' && <p className="text-sm text-red-700 dark:text-red-300">Could not load the stats.</p>}
      {state === 'ready' && lines.length === 0 && <p className="text-sm text-muted">{round.status === 'scheduled' ? 'The lines are minted when the round starts.' : 'Nobody was fielded for this round.'}</p>}
      {lines.length > 0 && sides && (
        <div className="space-y-4">
          {([1, 2] as const).map(side => bySide(side).length > 0 && (
            <section key={side} className="space-y-1" data-event-stats-side={side}>
              <h3 className="text-sm font-bold text-primary">{sides[side - 1]}</h3>
              {table(bySide(side))}
            </section>
          ))}
          {bySide(null).length > 0 && (
            <section className="space-y-1" data-event-stats-side="0">
              <h3 className="text-sm font-bold text-primary">Not yet on a side</h3>
              {table(bySide(null))}
            </section>
          )}
        </div>
      )}
      {lines.length > 0 && !sides && table(lines)}
    </div>
  );
}
