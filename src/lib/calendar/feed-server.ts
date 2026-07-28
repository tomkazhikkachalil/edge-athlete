// Subscribe-feed internals: capability-URL tokens (sha256 at rest —
// guardian_invites pattern; raw shown once, rotate = replace) and the
// ICS document Google/Outlook poll. Materialized occurrences mean the
// feed is plain VEVENTs with stable UIDs — subscribed calendars replace
// by UID on every refresh, and recently-cancelled events are included as
// STATUS:CANCELLED so lazy clients drop them too.

import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildVEvent, buildCalendar } from './ics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const PAST_WINDOW_MS = 30 * 86_400_000;
const FUTURE_WINDOW_MS = 183 * 86_400_000;
const FEED_LIMIT = 500;

const FEED_EVENT_FIELDS =
  'id, title, description, location, starts_at, ends_at, all_day, timezone, status, updated_at, cancelled_at';

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

export async function buildFeedIcs(
  admin: Admin,
  profileId: string,
  now: Date = new Date()
): Promise<string> {
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

  const rows = [...(activeRows ?? []), ...(cancelledRows ?? [])]
    .map(r => r.events as unknown as FeedEventRow)
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

  const vevents = rows.map(event =>
    buildVEvent({
      uid: `${event.id}@edge-athlete`,
      dtstampMs: Date.parse(event.updated_at ?? event.starts_at),
      startMs: Date.parse(event.starts_at),
      endMs: Date.parse(event.ends_at),
      allDay: event.all_day,
      timezone: event.timezone,
      title: event.title,
      description: event.description,
      location: event.location,
      cancelled: event.status === 'cancelled',
    })
  );
  return buildCalendar(vevents, { name: 'Edge Athlete', feedHints: true });
}
