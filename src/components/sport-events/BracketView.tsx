'use client';

import { bracketColumns, bracketWinner } from '@/lib/sport-events/bracket';
import { bracketMatchesFrom, type EventMatchesPayload } from '@/lib/sport-events/match-view';

/**
 * The bracket (Events program, phase 3, PR 10): a column per round from
 * `bracketColumns` — every slot a name list, "TBD" on the first round or
 * "Winner of match n" after, the winner bold with the result; the Final's
 * winner above. Columns side by side from `sm:` (scrolling sideways when
 * wide), stacked per round on a phone. Pure props: the matches route's
 * payload; nothing is fetched here.
 */
export default function BracketView({ data }: { data: EventMatchesPayload }) {
  const { byRound, names } = bracketMatchesFrom(data.matches);
  const cols = bracketColumns(data.rounds.map(r => ({ id: r.id, sequence: r.sequence, name: r.name, status: r.status, matches: byRound.get(r.id) ?? [] })));
  const winner = bracketWinner(cols);
  const nameOf = (id: string) => names.get(id) ?? 'Player';
  return (
    <div className="space-y-3" data-bracket-view="">
      {winner && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 dark:border-emerald-900 px-4 py-3 text-sm font-bold text-emerald-800 dark:text-emerald-200" data-bracket-winner="">
          <i className="fas fa-trophy mr-2" aria-hidden="true"></i>{winner.participantIds.map(nameOf).join(' & ')} wins the bracket
        </p>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:overflow-x-auto sm:items-start">
        {cols.map(col => (
          <section key={col.roundId} className="sm:min-w-[16rem] sm:shrink-0 space-y-2" data-bracket-column={col.sequence}>
            <h3 className="text-sm font-bold text-primary">{col.name}<span className="ml-2 text-xs font-normal text-muted">{col.status === 'live' ? 'live' : col.status === 'completed' ? 'final' : 'scheduled'}</span></h3>
            {col.slots.length === 0 && <p className="text-xs text-muted">No draw yet.</p>}
            <ol className="space-y-2">
              {col.slots.map(slot => (
                <li key={slot.sequence} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" data-bracket-slot={`${col.sequence}:${slot.sequence}`}>
                  <p className="text-[10px] uppercase tracking-wide text-muted">Match {slot.sequence}{slot.result ? ` · ${slot.result}` : ''}</p>
                  {slot.sides.map(side => (
                    <p key={side.label ?? side.members.join('+')} className={slot.winnerSide && slot.sides[slot.winnerSide - 1] === side ? 'font-bold text-primary' : side.members.length === 0 ? 'text-muted italic' : 'text-primary'} data-bracket-side={slot.sides.indexOf(side) + 1}>
                      {side.members.length > 0 ? side.members.map(nameOf).join(' & ') : side.label}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
