// Shared client types for the calendar feature — mirrors the API envelopes.

import type { EventRoutine } from '@/lib/calendar/event-routine';

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
  my_status: MyStatus;
  is_organizer: boolean;
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
