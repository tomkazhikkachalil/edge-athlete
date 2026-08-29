// Shared client types for the calendar feature — mirrors the API envelopes.

import type { EventRoutine } from '@/lib/calendar/event-routine';
import type { ActivityPayload } from '@/lib/calendar/activity-overlay';

export type MyStatus = 'invited' | 'accepted' | 'declined' | 'maybe';
export type CalendarViewKind = 'month' | 'week' | 'day' | 'agenda';
export type EditScope = 'this' | 'following' | 'series';

export interface SeriesRule {
  id: string;
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval_n: number;
  byweekday: number[] | null;
  ends: 'never' | 'until' | 'count';
  until_at: string | null;
  count_n: number | null;
}

export interface EventListItem {
  id: string;
  organizer_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  category: string;
  status: 'active' | 'cancelled';
  cancelled_at: string | null;
  series_id: string | null;
  series_override: boolean;
  /** Attached workout routine (080) — id only in list items. */
  routine_id?: string | null;
  league_id?: string | null;
  club_id?: string | null;
  /** null on read-time org-merged events — the viewer has no guest row
   *  (yet); their first RSVP creates one. */
  my_status: MyStatus | null;
  is_organizer: boolean;
  /** Present on org-merged list items (fan-out round). */
  is_org_event?: boolean;
  org_name?: string | null;
  /** Present on completed-activity overlay items; absent on real events.
   *  Activity items must never open EventDetailModal (guaranteed 404) —
   *  they deep-link to their home surface instead. */
  kind?: 'activity';
  activity?: ActivityPayload;
}

export interface EventGuest {
  id: string;
  profile_id: string | null;
  invited_email: string | null;
  role: 'organizer' | 'guest';
  status: MyStatus | 'accepted';
  responded_at: string | null;
  reminder_minutes: number;
  profiles: {
    id: string;
    first_name: string | null;
    middle_name: string | null;
    last_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
    handle: string | null;
  } | null;
}

export interface EventDetail extends Omit<EventListItem, 'my_status' | 'is_organizer'> {
  guests: EventGuest[];
  series: SeriesRule | null;
  /** Resolved routine view (live version, snapshot fallback) — never the raw snapshot. */
  routine: EventRoutine | null;
}

/** How the detail route admitted the viewer — org_member means "no guest
 *  row yet; offer RSVP" (their first response creates one). */
// 'household' = guardian/viewer seat of a guest (or org-member) profile —
// read-only by construction: RSVP keys off own guest row / org_member and
// Edit/Cancel off organizer, so this value lights no affordance.
export type ViewerAccess = 'organizer' | 'guest' | 'org_member' | 'household';
