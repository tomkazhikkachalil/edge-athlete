// Subscribe-feed internals: capability-URL tokens (sha256 at rest —
// guardian_invites pattern; raw shown once, rotate = replace) and the
// ICS document Google/Outlook poll. Materialized occurrences mean the
// feed is plain VEVENTs with stable UIDs — subscribed calendars replace
// by UID on every refresh, and recently-cancelled events are included as
// STATUS:CANCELLED so lazy clients drop them too.

import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildVEvent, buildCalendar } from './ics';
import { fetchOrgEventsForViewer } from './org-merge-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const PAST_WINDOW_MS = 30 * 86_400_000;
const FUTURE_WINDOW_MS = 183 * 86_400_000;
const FEED_LIMIT = 500;

const FEED_EVENT_FIELDS =
  'id, title, description, location, starts_at, ends_at, all_day, timezone, status, updated_at, cancelled_at, league_id, club_id, division_id, team_id, venue_id, facility_id';

export function generateFeedToken(): string {
  return randomBytes(32).toString('base64url'); // 43 chars
}

export function hashFeedToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

interface FeedEventRow {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  status: 'active' | 'cancelled';
  updated_at: string | null;
  cancelled_at: string | null;
}

async function fetchFeedRows(
  admin: Admin,
  profileId: string,
  now: Date
): Promise<FeedEventRow[]> {
  const windowStart = new Date(now.getTime() - PAST_WINDOW_MS).toISOString();
  const windowEnd = new Date(now.getTime() + FUTURE_WINDOW_MS).toISOString();

  const base = () =>
    admin
      .from('event_guests')
      .select(`events!inner(${FEED_EVENT_FIELDS})`)
      .eq('profile_id', profileId)
      .neq('status', 'declined')
      .lt('events.starts_at', windowEnd)
      .gt('events.ends_at', windowStart)
      .limit(FEED_LIMIT);

  const [{ data: activeRows }, { data: cancelledRows }] = await Promise.all([
    base().eq('events.status', 'active'),
    base()
      .eq('events.status', 'cancelled')
      .gt('events.cancelled_at', new Date(now.getTime() - PAST_WINDOW_MS).toISOString()),
  ]);

  const guestEvents = [...(activeRows ?? []), ...(cancelledRows ?? [])].map(
    r => r.events as unknown as FeedEventRow
  );

  // Read-time org merge: a member's subscribed calendar shows the same
  // schedule as the in-app one. Guest rows stay authoritative (the merge
  // drops events the member holds a row on — a declined org event stays
  // out of the feed); recently-cancelled org events emit STATUS:CANCELLED
  // like everything else. Best-effort: a failure never breaks the feed.
  try {
    const orgEvents = await fetchOrgEventsForViewer(
      admin,
      profileId,
      now.getTime() - PAST_WINDOW_MS,
      now.getTime() + FUTURE_WINDOW_MS,
      {
        fields: FEED_EVENT_FIELDS,
        includeCancelledAfter: new Date(now.getTime() - PAST_WINDOW_MS).toISOString(),
      }
    );
    guestEvents.push(...(orgEvents as unknown as FeedEventRow[]));
  } catch (e) {
    console.error('[CALENDAR FEED] org merge failed:', e);
  }

  return guestEvents;
}

export async function buildFeedIcs(
  admin: Admin,
  profileId: string,
  now: Date = new Date()
): Promise<string> {
  // Round I: the feed owner's events, plus their managed SUPERVISED
  // athletes' events prefixed with the child's name. This is how a parent
  // gets the family schedule into their own calendar app — the child's own
  // feed stays disabled (mint 403 + serve 404), so the parent-held
  // capability URL is the only sync path a supervised schedule has.
  // Guardian-parity round: view-only seats (the grandparent) get the same
  // children — the feed is a pure read, and viewers already see these
  // schedules in-app; excluding them here was a parity gap, not a gate.
  const { data: managed } = await admin
    .from('profile_access')
    .select('profile_id, profiles!profile_access_profile_id_fkey(first_name, supervision_state)')
    .eq('user_id', profileId)
    .in('role', ['guardian', 'viewer']);
  const children = (managed ?? [])
    .map(r => ({
      id: r.profile_id as string,
      profile: r.profiles as unknown as { first_name: string | null; supervision_state: string | null },
    }))
    .filter(c => c.profile?.supervision_state === 'supervised');

  const [ownRows, ...childRowSets] = await Promise.all([
    fetchFeedRows(admin, profileId, now),
    ...children.map(c => fetchFeedRows(admin, c.id, now)),
  ]);

  // Dedupe by event id — the guardian and a child can be guests of the SAME
  // event, and calendar apps key on uid. Own rows win (no prefix).
  const seen = new Set<string>();
  const entries: Array<{ event: FeedEventRow; prefix: string }> = [
    ...ownRows.map(event => ({ event, prefix: '' })),
    ...childRowSets.flatMap((rows, i) =>
      rows.map(event => ({
        event,
        prefix: `${children[i].profile?.first_name || 'Athlete'}: `,
      }))
    ),
  ]
    .filter(({ event }) => (seen.has(event.id) ? false : (seen.add(event.id), true)))
    .sort((a, b) => Date.parse(a.event.starts_at) - Date.parse(b.event.starts_at));

  const vevents = entries.map(({ event, prefix }) =>
    buildVEvent({
      uid: `${event.id}@edge-athlete`,
      dtstampMs: Date.parse(event.updated_at ?? event.starts_at),
      startMs: Date.parse(event.starts_at),
      endMs: Date.parse(event.ends_at),
      allDay: event.all_day,
      timezone: event.timezone,
      title: `${prefix}${event.title}`,
      description: event.description,
      location: event.location,
      cancelled: event.status === 'cancelled',
    })
  );
  return buildCalendar(vevents, { name: 'Edge Athlete', feedHints: true });
}
