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
 *   READ a row's KIND        →  select ORG_KIND_EMBED        — organizations.kind, never the pair (step D0)
 *   ACCEPT / EMIT the public league_id / club_id fields → orgRefFromBody / pairFieldsFor (the boundary)
 *   WRITE a row for an org   →  { ...pairFor(ref) }         — org_id (the pair is GONE since 235)
 *   TOUCH the org row itself →  .from('organizations')     — the one table; a LIST of one kind adds .eq('kind', kind)
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

/** The select fragment that carries a pair-table row's KIND (step D0): a
 *  LEFT embed through the table's one FK to organizations, so a row whose
 *  org_id is null (events, venues, sport_events, athlete_claim_invites)
 *  survives with `org: null`. No FK hint is needed — every pair table has
 *  exactly one FK to organizations. Aliased `org` because `memberships.kind`
 *  would collide with the org's `kind`. A missing relationship answers
 *  PGRST200, not 42703. `org_staff_audit` has no FK (232) and cannot embed. */
export const ORG_KIND_EMBED = 'org:organizations(kind)' as const;

/** The INNER form for a read that lists ONE KIND's rows with no org id to
 *  match (a profile's leagues; the club directory): only `!inner` lets a
 *  filter on the embedded column — `.eq('org.kind', kind)` — restrict the
 *  parent rows; on a left embed the filter merely nulls the embed. */
export const ORG_KIND_EMBED_INNER = 'org:organizations!inner(kind)' as const;

/** What a pair-table row carries after D0: `org_id` and, when the select
 *  asked for ORG_KIND_EMBED, the org's kind. PostgREST answers a many-to-one
 *  embed as an object; the array shape is tolerated for an untyped client. */
/** The embed's answer: an object from PostgREST, an array in the typed
 *  client's inference (no FK typing) — every row type spells it this way. */
export type OrgKindEmbed = { kind: string } | { kind: string }[] | null;

export interface OrgKindRow {
  org_id?: string | null;
  org?: OrgKindEmbed;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The PUBLIC body fields `league_id` / `club_id`, accepted at the route
 *  boundary (Tom, Sep 22 2026: the contract does not change) and turned into
 *  the ref the code passes around. `null` / absent on both = no org. */
export type OrgBodyRef =
  | { ok: true; ref: OrgRef | null }
  | { ok: false; error: 'both' | 'invalid' };

export function orgRefFromBody(body: { league_id?: unknown; club_id?: unknown }): OrgBodyRef {
  const read = (v: unknown): string | null | undefined => {
    if (v === undefined || v === null) return null;
    return typeof v === 'string' && UUID_RE.test(v) ? v : undefined;
  };
  const league = read(body.league_id);
  const club = read(body.club_id);
  if (league === undefined || club === undefined) return { ok: false, error: 'invalid' };
  if (league && club) return { ok: false, error: 'both' };
  if (league) return { ok: true, ref: { side: 'league', orgId: league } };
  if (club) return { ok: true, ref: { side: 'club', orgId: club } };
  return { ok: true, ref: null };
}

/** The PUBLIC response fields for an org ref — the shape every client and
 *  spec reads today, derived from org_id + kind rather than stored. */
export function pairFieldsFor(ref: OrgRef | null | undefined): { league_id: string | null; club_id: string | null } {
  return {
    league_id: ref?.side === 'league' ? ref.orgId : null,
    club_id: ref?.side === 'club' ? ref.orgId : null,
  };
}

/** `pairFieldsFor(orgRefOf(row))` — for a row selected with ORG_KIND_EMBED
 *  that is emitted to a client. */
export function pairFieldsOf(row: OrgKindRow): { league_id: string | null; club_id: string | null } {
  return pairFieldsFor(orgRefOf(row));
}

/** A stored row as a CLIENT reads it: the embed stripped, the public
 *  league_id / club_id derived from org_id + kind (Tom, Sep 22 2026: the
 *  contract does not change). */
export function publicOrgRow<T extends OrgKindRow>(row: T): Omit<T, 'org'> & { league_id: string | null; club_id: string | null } {
  const { org: _org, ...rest } = row; // eslint-disable-line @typescript-eslint/no-unused-vars -- stripped on purpose
  return { ...rest, ...pairFieldsFor(orgRefOf(row)) };
}

/** The pair column NAME of a kind — no pair table has it any more (235).
 *  Two uses remain: the two side-specific tables (`league_join_requests` /
 *  `club_join_requests`, their OWN column, until D-ii unifies them) and the
 *  notifications `metadata` key the announce readers match on
 *  (`metadata @> {league_id}` — history, so forever). */
export const PAIR_COLUMN: Record<OrgKind, 'league_id' | 'club_id'> = {
  league: 'league_id',
  club: 'club_id',
};

/** The URL family: `/api/leagues/…`, `/leagues`, `/league/[id]`. Spelled
 *  the same as the table today and deliberately a separate constant — the
 *  table goes away in step D, the URLs never do. */
export const ORG_ROUTE_FAMILY: Record<OrgKind, 'leagues' | 'clubs'> = {
  league: 'leagues',
  club: 'clubs',
};

/** The org for a write: `org_id`. (The name is from the mirror window,
 *  when it was the pair; the call sites did not change.) Spread it into
 *  the insert. */
export function pairFor(ref: OrgRef): { org_id: string } {
  return { org_id: ref.orgId };
}

/** The kind a row names: the embedded `organizations.kind` — the select
 *  must carry ORG_KIND_EMBED. Null when the row names no org or the select
 *  did not ask. */
export function orgKindOf(row: OrgKindRow): OrgKind | null {
  const org = Array.isArray(row.org) ? row.org[0] : row.org;
  return org && isOrgKind(org.kind) ? org.kind : null;
}

/** The org a row names: `org_id`. A row check compares this, never
 *  `row[column]`. */
export function orgIdOf(row: OrgKindRow): string | null {
  return row.org_id ?? null;
}

/** The ref a row names — null when it names no org or the kind is unknown. */
export function orgRefOf(row: OrgKindRow): OrgRef | null {
  const orgId = orgIdOf(row);
  const side = orgKindOf(row);
  return orgId && side ? { side, orgId } : null;
}
