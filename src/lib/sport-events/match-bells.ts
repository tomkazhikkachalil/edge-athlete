/**
 * The match bells' rules (Events program, phase 3, PR 12; migration 213
 * `sport_event_match`) — pure. `set` goes to every member of a COMPLETE
 * match whose match CHANGED with this save (a re-save of the same draw
 * bells nobody; a new opponent, a new partner or a first placement does);
 * `won` / `lost` go to each member of a decided match at the round's
 * completion (a bye bells nobody). The copy names the opponent(s) and, on
 * pairs, the partner.
 */
export interface DrawGroupForBells {
  members: Array<{ participant_id: string; side: 1 | 2 | null }>;
  /** Both sides full (the engine's `sidesOf` said ok and not a bye). */
  complete: boolean;
}

export interface MatchSetRecipient {
  participant_id: string;
  partner: string[];
  opponents: string[];
}

const keyOf = (members: ReadonlyArray<{ participant_id: string; side: 1 | 2 | null }>) => [...members].map(m => `${m.participant_id}:${m.side ?? ''}`).sort().join('|');

export function matchSetRecipients(previous: ReadonlyArray<DrawGroupForBells>, next: ReadonlyArray<DrawGroupForBells>): MatchSetRecipient[] {
  const before = new Map<string, string>();
  for (const g of previous) if (g.complete) { const k = keyOf(g.members); for (const m of g.members) before.set(m.participant_id, k); }
  const out: MatchSetRecipient[] = [];
  for (const g of next) {
    if (!g.complete) continue;
    const k = keyOf(g.members);
    for (const m of g.members) {
      if (before.get(m.participant_id) === k) continue;
      out.push({
        participant_id: m.participant_id,
        partner: g.members.filter(x => x.participant_id !== m.participant_id && x.side === m.side).map(x => x.participant_id),
        opponents: g.members.filter(x => x.side !== m.side).map(x => x.participant_id),
      });
    }
  }
  return out;
}

/** "You play Bob" · "You and Al play Bob & Ben". */
export function matchSetLine(partner: ReadonlyArray<string>, opponents: ReadonlyArray<string>): string {
  const you = partner.length > 0 ? `You and ${partner.join(' & ')}` : 'You';
  return `${you} play ${opponents.join(' & ') || 'your opponent'}`;
}

/** "You beat Bob 3&2" · "Bob & Ben beat you 2 up" · "You and Al beat Bob & Ben · conceded". */
export function matchClosedLine(won: boolean, partner: ReadonlyArray<string>, opponents: ReadonlyArray<string>, result: string | null): string {
  const you = partner.length > 0 ? `You and ${partner.join(' & ')}` : 'You';
  const them = opponents.join(' & ') || 'your opponent';
  const tail = result ? (/^\d/.test(result) ? ` ${result}` : ` · ${result}`) : '';
  return won ? `${you} beat ${them}${tail}` : `${them} beat you${tail}`;
}
