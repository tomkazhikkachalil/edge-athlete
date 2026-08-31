// ── Read-time org-event merge (fan-out round, follows the 119 scope note) ────
// A member's calendar shows their orgs' events WITHOUT any guest rows being
// written: membership is open-join and uncapped while events cap at
// MAX_GUESTS, series materialize up to 104 occurrences, and write-side
// fan-out would miss members who join after the event exists. The merge is
// derived per read; RSVPing creates a real guest row (respond route), and
// from then on that row is authoritative — which is also how a member's
// "declined" hides an org event (the merge drops any event where the viewer
// holds their OWN guest row, whatever its status).
//
// SCOPES (0.9, strict audience — Tom, Aug 31): org-scope membership merges
// ORG-scoped events only; a division/team membership row merges that
// scope's events, a team's entered divisions, and the OWNING org's events
// (child sees up, parent never sees down — parent-implies-child applies to
// grants, not audience). v1 runs dormant: nothing mints sub-org rows yet.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/leagues/validate';
import { memberOrgIds } from '@/lib/orgs/members';
import { viewerScopeSet } from '@/lib/orgs/scoped-members';
import { EVENT_FIELDS } from './detail-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const ORG_EVENT_LIMIT = 500; // defensive cap per scope kind — FEED_LIMIT precedent

export interface OrgEventRow {
  id: string;
  league_id?: string | null;
  club_id?: string | null;
  division_id?: string | null;
  team_id?: string | null;
  [key: string]: unknown;
}

export interface OrgMergedEvent extends OrgEventRow {
  my_status: null;
  is_organizer: false;
  is_org_event: true;
  org_name: string | null;
}

/** Pure core: the scope lists' events (precedence order), deduped by id,
 *  minus every event the viewer already holds a guest row on (ANY status —
 *  declined included). org_name resolves through the event's own org
 *  columns, or through scopeOrg (division/team id → owning org id) for
 *  sub-org-scoped events. */
export function mergeOrgEvents(
  ownGuestEventIds: ReadonlySet<string>,
  eventLists: OrgEventRow[][],
  orgNames: ReadonlyMap<string, string>,
  scopeOrg: ReadonlyMap<string, string> = new Map()
): OrgMergedEvent[] {
  const seen = new Set<string>();
  const merged: OrgMergedEvent[] = [];
  for (const event of eventLists.flat()) {
    if (ownGuestEventIds.has(event.id) || seen.has(event.id)) continue;
    seen.add(event.id);
    const scopeId = (event.division_id ?? event.team_id) as string | null;
    const orgId =
      (event.league_id ?? event.club_id) ?? (scopeId ? (scopeOrg.get(scopeId) ?? null) : null);
    merged.push({
      ...event,
      my_status: null,
      is_organizer: false,
      is_org_event: true,
      org_name: (orgId ? orgNames.get(orgId) : null) ?? null,
    });
  }
  return merged;
}

export interface FetchOrgEventsOptions {
  /** Column list for the events select — defaults to the detail EVENT_FIELDS.
   *  Must include the four scope columns (org-name resolution keys on them). */
  fields?: string;
  /** Also include cancelled events with cancelled_at after this ISO instant
   *  (the ICS feed's STATUS:CANCELLED window). Omit for active-only. */
  includeCancelledAfter?: string | null;
}

/** The viewer's org + scoped events for a time window, already merged/
 *  decorated. Throws only on unexpected errors — missing org tables
 *  (pre-117 DB) and missing 119/146 columns degrade to []. Callers keep the
 *  calendar up regardless (activity-overlay precedent): wrap in try/catch
 *  at the call site. */
export async function fetchOrgEventsForViewer(
  admin: Admin,
  profileId: string,
  fromMs: number,
  toMs: number,
  options: FetchOrgEventsOptions = {}
): Promise<OrgMergedEvent[]> {
  const fields = options.fields ?? EVENT_FIELDS;

  // 0.10 puts the kind='roster' predicate on THIS membership read (via a
  // roster-only variant in orgs/members.ts) — and nowhere else.
  const [{ leagueIds: ownLeagueIds, clubIds: ownClubIds }, scopes] = await Promise.all([
    memberOrgIds(admin, profileId),
    viewerScopeSet(admin, profileId),
  ]);
  // A team/division member also sees the OWNING org's events (child sees up).
  const leagueIds = [...new Set([...ownLeagueIds, ...scopes.leagueIds])];
  const clubIds = [...new Set([...ownClubIds, ...scopes.clubIds])];
  if (
    leagueIds.length === 0 &&
    clubIds.length === 0 &&
    scopes.divisionIds.length === 0 &&
    scopes.teamIds.length === 0
  ) {
    return [];
  }

  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const eventsIn = (
    column: 'league_id' | 'club_id' | 'division_id' | 'team_id',
    scopeIds: string[]
  ) => {
    if (scopeIds.length === 0) return Promise.resolve({ data: [], error: null });
    let query = admin
      .from('events')
      .select(fields)
      .in(column, scopeIds)
      .lt('starts_at', toIso)
      .gt('ends_at', fromIso)
      .limit(ORG_EVENT_LIMIT);
    query = options.includeCancelledAfter
      ? query.or(`status.eq.active,and(status.eq.cancelled,cancelled_at.gt.${options.includeCancelledAfter})`)
      : query.eq('status', 'active');
    return query;
  };
  const [leagueRes, clubRes, divisionRes, teamRes] = await Promise.all([
    eventsIn('league_id', leagueIds),
    eventsIn('club_id', clubIds),
    eventsIn('division_id', scopes.divisionIds),
    eventsIn('team_id', scopes.teamIds),
  ]);
  for (const { error } of [leagueRes, clubRes, divisionRes, teamRes]) {
    // 42703: pre-119/146 database without the scope columns — empty, never
    // an error.
    if (error && !isMissingTableError(error.code) && error.code !== '42703') throw error;
  }
  const eventLists = [leagueRes, clubRes, divisionRes, teamRes].map(
    r => (r.data ?? []) as unknown as OrgEventRow[]
  );
  const candidateIds = [...new Set(eventLists.flat().map(e => e.id))];
  if (candidateIds.length === 0) return [];

  const { data: ownGuestRows, error: guestError } = await admin
    .from('event_guests')
    .select('event_id')
    .in('event_id', candidateIds)
    .eq('profile_id', profileId);
  if (guestError) throw guestError;
  const ownGuestEventIds = new Set((ownGuestRows ?? []).map(r => r.event_id as string));

  const nameQueries = await Promise.all([
    leagueIds.length > 0
      ? admin.from('leagues').select('id, name').in('id', leagueIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    clubIds.length > 0
      ? admin.from('clubs').select('id, name').in('id', clubIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const orgNames = new Map<string, string>(
    nameQueries.flatMap(({ data }) => (data ?? []).map(r => [r.id as string, r.name as string] as const))
  );

  return mergeOrgEvents(ownGuestEventIds, eventLists, orgNames, scopes.scopeOrg);
}
