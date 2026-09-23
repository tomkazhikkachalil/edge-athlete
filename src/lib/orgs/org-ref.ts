/**
 * The ONE module that knows how an org is named (Round 5 step B, Sep 2026).
 *
 * Before this file an org was a nullable (league_id, club_id) pair on
 * fifteen tables, spelled by 23 identical `orgColumn` copies, ~60 inline
 * column ternaries and ~50 table ternaries. Since migration 232 every pair
 * table carries `org_id` (generated from the pair during the mirror window,
 * a real column after step C), so:
 *
 *   READ an org's rows       →  .eq(ORG_ID, orgId)          — never the pair
 *   WRITE a row for an org   →  { ...pairFor(ref) }         — the pair, until step C
 *   TOUCH the org row itself →  .from(ORG_TABLE[kind])      — until step D (views)
 *   SPELL a URL family       →  ORG_ROUTE_FAMILY[kind]      — forever (URLs never change)
 *
 * `OrgKind` is what an org calls itself (its route family and vocabulary —
 * Tom's decision; `operates_competitions` / `operates_teams` stay the
 * behaviour switches). The old name `OrgSide` is this type under its old
 * name until step F retires it.
 *
 * ZERO imports on purpose: client components spell URL families from here.
 */

export type OrgKind = 'league' | 'club';

export const ORG_KINDS: readonly OrgKind[] = ['league', 'club'];

export function isOrgKind(value: unknown): value is OrgKind {
  return value === 'league' || value === 'club';
}

export function otherKind(kind: OrgKind): OrgKind {
  return kind === 'league' ? 'club' : 'league';
}

/** An org, named: the kind and the id. The field names match the shape the
 *  code already passed around (`scope.side`, `scope.orgId`) so a caller's
 *  object literal keeps working; `side` IS the kind. */
export interface OrgRef {
  side: OrgKind;
  orgId: string;
}

/** The read column on every pair table since 232 — equal to
 *  COALESCE(league_id, club_id), so `org_id = X` is exactly
 *  `league_id = X OR club_id = X` and the kind is not needed to read. */
export const ORG_ID = 'org_id' as const;

/** The pair column of a kind. For WRITES in the mirror window (the
 *  generated org_id follows), for the two side-specific tables
 *  (league_join_requests / club_join_requests) and for the notifications
 *  `metadata` key the announce readers match on (`metadata @> {league_id}`).
 *  Never for a read of a pair table — that is ORG_ID. */
export const PAIR_COLUMN: Record<OrgKind, 'league_id' | 'club_id'> = {
  league: 'league_id',
  club: 'club_id',
};

/** The org row's own table — the mirror's SOURCE until step C, a view
 *  after step D. */
export const ORG_TABLE: Record<OrgKind, 'leagues' | 'clubs'> = {
  league: 'leagues',
  club: 'clubs',
};

/** The URL family: `/api/leagues/…`, `/leagues`, `/league/[id]`. Spelled
 *  the same as the table today and deliberately a separate constant — the
 *  table goes away in step D, the URLs never do. */
export const ORG_ROUTE_FAMILY: Record<OrgKind, 'leagues' | 'clubs'> = {
  league: 'leagues',
  club: 'clubs',
};

/** The pair for a write: exactly one of the two set, the other null (the
 *  pairing CHECKs want exactly one). Spread it into the insert. */
export function pairFor(ref: OrgRef): { league_id: string | null; club_id: string | null } {
  return {
    league_id: ref.side === 'league' ? ref.orgId : null,
    club_id: ref.side === 'club' ? ref.orgId : null,
  };
}

/** The kind a row names through its pair — null when it names no org. */
export function orgKindOf(row: { league_id?: string | null; club_id?: string | null }): OrgKind | null {
  if (row.league_id) return 'league';
  if (row.club_id) return 'club';
  return null;
}

/** The org a row names, from whichever column the select carried: `org_id`
 *  when it was selected, else the pair. A row check compares this, never
 *  `row[column]`. */
export function orgIdOf(row: { org_id?: string | null; league_id?: string | null; club_id?: string | null }): string | null {
  return row.org_id ?? row.league_id ?? row.club_id ?? null;
}

/** The ref a row names through its pair — null when it names no org. */
export function orgRefOf(row: { league_id?: string | null; club_id?: string | null }): OrgRef | null {
  if (row.league_id) return { side: 'league', orgId: row.league_id };
  if (row.club_id) return { side: 'club', orgId: row.club_id };
  return null;
}
