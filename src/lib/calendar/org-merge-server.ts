// ── Read-time org-event merge (fan-out round, follows the 119 scope note) ────
// A member's calendar shows their orgs' events WITHOUT any guest rows being
// written: membership is open-join and uncapped while events cap at
// MAX_GUESTS, series materialize up to 104 occurrences, and write-side
// fan-out would miss members who join after the event exists. The merge is
// derived per read; RSVPing creates a real guest row (respond route), and
// from then on that row is authoritative — which is also how a member's
// "declined" hides an org event (the merge drops any event where the viewer
// holds their OWN guest row, whatever its status).

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/leagues/validate';
import { memberOrgIds } from '@/lib/orgs/members';
import { EVENT_FIELDS } from './detail-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const ORG_EVENT_LIMIT = 500; // defensive cap per org kind — FEED_LIMIT precedent

export interface OrgEventRow {
  id: string;
  league_id?: string | null;
  club_id?: string | null;
  [key: string]: unknown;
}

export interface OrgMergedEvent extends OrgEventRow {
  my_status: null;
  is_organizer: false;
  is_org_event: true;
  org_name: string | null;
}

/** Pure core: league ∪ club events, deduped by id, minus every event the
 *  viewer already holds a guest row on (ANY status — declined included). */
export function mergeOrgEvents(
  ownGuestEventIds: ReadonlySet<string>,
  leagueEvents: OrgEventRow[],
  clubEvents: OrgEventRow[],
  orgNames: ReadonlyMap<string, string>
): OrgMergedEvent[] {
  const seen = new Set<string>();
  const merged: OrgMergedEvent[] = [];
  for (const event of [...leagueEvents, ...clubEvents]) {
    if (ownGuestEventIds.has(event.id) || seen.has(event.id)) continue;
    seen.add(event.id);
    const orgId = (event.league_id ?? event.club_id) as string | null;
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
   *  Must include league_id and club_id (org-name resolution keys on them). */
  fields?: string;
  /** Also include cancelled events with cancelled_at after this ISO instant
   *  (the ICS feed's STATUS:CANCELLED window). Omit for active-only. */
  includeCancelledAfter?: string | null;
}

/** The viewer's org events for a time window, already merged/decorated.
 *  Throws only on unexpected errors — missing org tables (pre-117 DB) and a
 *  missing 119 column degrade to []. Callers keep the calendar up regardless
 *  (activity-overlay precedent): wrap in try/catch at the call site. */
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
  const { leagueIds, clubIds } = await memberOrgIds(admin, profileId);
  if (leagueIds.length === 0 && clubIds.length === 0) return [];

  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();
  const eventsIn = (column: 'league_id' | 'club_id', orgIds: string[]) => {
    if (orgIds.length === 0) return Promise.resolve({ data: [], error: null });
    let query = admin
      .from('events')
      .select(fields)
      .in(column, orgIds)
      .lt('starts_at', toIso)
      .gt('ends_at', fromIso)
      .limit(ORG_EVENT_LIMIT);
    query = options.includeCancelledAfter
      ? query.or(`status.eq.active,and(status.eq.cancelled,cancelled_at.gt.${options.includeCancelledAfter})`)
      : query.eq('status', 'active');
    return query;
  };
  const [leagueRes, clubRes] = await Promise.all([
    eventsIn('league_id', leagueIds),
    eventsIn('club_id', clubIds),
  ]);
  for (const { error } of [leagueRes, clubRes]) {
    // 42703: pre-119 database without the org columns — empty, never an error.
    if (error && !isMissingTableError(error.code) && error.code !== '42703') throw error;
  }
  const leagueEvents = (leagueRes.data ?? []) as unknown as OrgEventRow[];
  const clubEvents = (clubRes.data ?? []) as unknown as OrgEventRow[];
  const candidateIds = [...new Set([...leagueEvents, ...clubEvents].map(e => e.id))];
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

  return mergeOrgEvents(ownGuestEventIds, leagueEvents, clubEvents, orgNames);
}
