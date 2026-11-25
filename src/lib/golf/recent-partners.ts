// ── Recent playing partners (golf part 2, Nov 24 2026) ───────────────────────
// Pure, zero imports. The Players step's QUICK ADD row: the people in the
// account's own latest golf rounds, each once, the newest round first.
// Derived from the rounds' participant rows — nothing new is stored (no
// table records "people I played with").
//
// The route reads the account's newest participations (it is a participant
// of every round it created too), then every OTHER participant of those
// rounds; this decides who is offered and in what order.

export const RECENT_PARTNERS_MAX = 8;
/** How many of the account's newest golf rounds are read. */
export const RECENT_PARTNER_ROUNDS_SCANNED = 20;

export interface RecentPartnerRow {
  profile_id?: unknown;
  /** The partner's answer to the round's invitation. */
  status?: unknown;
  /** ISO timestamp of the round they shared. */
  at?: unknown;
}

/** Rows in any order → the distinct partner ids, newest shared round first,
 *  capped. The account itself is never its own partner; a person who
 *  DECLINED a round was not played with; a row without a usable time sorts
 *  last (they still shared a round). */
export function recentPartnerIds(rows: readonly RecentPartnerRow[], selfId: string, max: number = RECENT_PARTNERS_MAX): string[] {
  const time = (row: RecentPartnerRow) => {
    const t = typeof row?.at === 'string' ? Date.parse(row.at) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  const sorted = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => time(b.row) - time(a.row) || a.i - b.i);
  const out: string[] = [];
  for (const { row } of sorted) {
    const id = row?.profile_id;
    if (typeof id !== 'string' || id === '' || id === selfId || out.includes(id)) continue;
    if (row?.status === 'declined') continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

export interface QuickAddPerson {
  id: string;
  name: string;
  avatar_url?: string;
}

/** Who the QUICK ADD row still offers: the suggested people who are not
 *  already partners of this round, in the order they were suggested. Adding
 *  someone takes them off the row; removing them brings them back. */
export function quickAddOffered<P extends { id: string }>(suggested: readonly P[], addedIds: readonly string[]): P[] {
  const added = new Set(addedIds);
  return suggested.filter(p => !added.has(p.id));
}

/** The name a partner row shows, from a profile's name fields. */
export function partnerName(p: { first_name?: string | null; last_name?: string | null; full_name?: string | null }): string {
  if (p.first_name && p.last_name) return `${p.first_name} ${p.last_name}`;
  return p.full_name || p.first_name || 'Unknown User';
}
