'use client';

import BracketColumnsView from '@/components/competitions/BracketColumnsView';
import { bracketColumns, bracketWinner } from '@/lib/sport-events/bracket';
import { bracketMatchesFrom, type EventMatchesPayload } from '@/lib/sport-events/match-view';

/**
 * The bracket (Events program, phase 3, PR 10): a column per round from
 * `bracketColumns` — every slot a name list, "TBD" on the first round or
 * "Winner of match n" after, the winner bold with the result; the Final's
 * winner above. Since track 2 PR 4 a thin wrapper over the shared
 * `BracketColumnsView` (the org competitions draw the same columns).
 * Pure props: the matches route's payload; nothing is fetched here.
 */
export default function BracketView({ data }: { data: EventMatchesPayload }) {
  const { byRound, names } = bracketMatchesFrom(data.matches);
  const cols = bracketColumns(data.rounds.map(r => ({ id: r.id, sequence: r.sequence, name: r.name, status: r.status, matches: byRound.get(r.id) ?? [] })));
  const winner = bracketWinner(cols);
  const nameOf = (id: string) => names.get(id) ?? 'Player';
  return (
    <BracketColumnsView
      winner={winner ? winner.participantIds.map(nameOf).join(' & ') : null}
      columns={cols.map(col => ({
        key: String(col.sequence),
        name: col.name,
        status: col.status === 'live' ? 'live' : col.status === 'completed' ? 'final' : 'scheduled',
        slots: col.slots.map(slot => ({
          key: `${col.sequence}:${slot.sequence}`,
          title: `Match ${slot.sequence}`,
          result: slot.result,
          sides: slot.sides.map((side, i) => ({
            key: side.label ?? side.members.join('+') ?? String(i),
            label: side.members.length > 0 ? side.members.map(nameOf).join(' & ') : (side.label ?? 'TBD'),
            won: !!slot.winnerSide && slot.winnerSide - 1 === i,
            empty: side.members.length === 0,
          })),
        })),
      }))}
    />
  );
}
