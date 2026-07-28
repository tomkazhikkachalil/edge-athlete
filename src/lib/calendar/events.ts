// Calendar event validation — pure logic (routes: /api/calendar/*).
// Validation mirrors the DB CHECK constraints (migration 057) so Postgres
// errors are never the first line of defense. Times travel as ISO strings
// and are re-normalized through Date.parse; the event's `timezone` is the
// IANA zone it was created in (display is always viewer-local). All-day
// events must span local midnights in that zone, end exclusive — enforced
// here so a client bug surfaces as a 400 instead of an off-by-one grid.

import { emailString } from '../validation';

export const EVENT_CATEGORIES = [
  'general', 'practice', 'game', 'tournament', 'training', 'social', 'other',
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 2000;
export const MAX_LOCATION = 200;
export const MAX_EVENT_DAYS = 14;
export const MAX_GUESTS = 50;
const FIVE_YEARS_MS = 5 * 365 * 86_400_000;

export interface NormalizedEventInput {
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  category: EventCategory;
}

export interface NormalizedGuestInput {
  profileIds: string[];
  emails: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidTimeZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** 'HH:mm' of an instant in a zone (dependency-free). */
function timeInZone(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(ms));
}

function nullOrTrimmed(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined; // signals invalid
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

export function validateEventInput(
  raw: unknown
): { ok: true; event: NormalizedEventInput } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: 'Invalid event payload.' };
  }
  const body = raw as Record<string, unknown>;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return { ok: false, error: 'Please give the event a title.' };
  if (title.length > MAX_TITLE) {
    return { ok: false, error: `Title must be ${MAX_TITLE} characters or fewer.` };
  }

  const description = nullOrTrimmed(body.description, MAX_DESCRIPTION);
  if (description === undefined) {
    return { ok: false, error: `Description must be ${MAX_DESCRIPTION} characters or fewer.` };
  }
  const location = nullOrTrimmed(body.location, MAX_LOCATION);
  if (location === undefined) {
    return { ok: false, error: `Location must be ${MAX_LOCATION} characters or fewer.` };
  }

  const startsMs = typeof body.starts_at === 'string' ? Date.parse(body.starts_at) : NaN;
  const endsMs = typeof body.ends_at === 'string' ? Date.parse(body.ends_at) : NaN;
  if (!Number.isFinite(startsMs) || !Number.isFinite(endsMs)) {
    return { ok: false, error: 'Please provide a valid start and end time.' };
  }
  if (endsMs <= startsMs) {
    return { ok: false, error: 'The event must end after it starts.' };
  }
  if (endsMs - startsMs > MAX_EVENT_DAYS * 86_400_000) {
    return { ok: false, error: `Events can span at most ${MAX_EVENT_DAYS} days.` };
  }
  const now = Date.now();
  if (startsMs < now - FIVE_YEARS_MS || startsMs > now + FIVE_YEARS_MS) {
    return { ok: false, error: 'The event date must be within five years of today.' };
  }

  const timezone = typeof body.timezone === 'string' ? body.timezone.trim() : '';
  if (!isValidTimeZone(timezone)) {
    return { ok: false, error: 'Invalid time zone.' };
  }

  const all_day = body.all_day === true;
  if (all_day) {
    // Both bounds must be local midnight in the event's zone (end exclusive).
    if (timeInZone(startsMs, timezone) !== '00:00' || timeInZone(endsMs, timezone) !== '00:00') {
      return { ok: false, error: 'All-day events must start and end at midnight in their time zone.' };
    }
  }

  const category = typeof body.category === 'string' ? body.category : 'general';
  if (!(EVENT_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: 'Unknown event category.' };
  }

  return {
    ok: true,
    event: {
      title,
      description,
      location,
      starts_at: new Date(startsMs).toISOString(),
      ends_at: new Date(endsMs).toISOString(),
      all_day,
      timezone,
      category: category as EventCategory,
    },
  };
}

export function validateGuestInput(
  raw: unknown,
  selfId: string,
  existingCount = 0
): { ok: true; guests: NormalizedGuestInput } | { ok: false; error: string } {
  const body = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawIds = Array.isArray(body.profile_ids) ? body.profile_ids : [];
  const rawEmails = Array.isArray(body.emails) ? body.emails : [];

  const profileIds: string[] = [];
  for (const id of rawIds) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return { ok: false, error: 'Invalid guest.' };
    }
    if (id === selfId) {
      return { ok: false, error: "You're the organizer — no need to invite yourself." };
    }
    if (!profileIds.includes(id)) profileIds.push(id);
  }

  const emails: string[] = [];
  for (const email of rawEmails) {
    const parsed = emailString.safeParse(email);
    if (!parsed.success) {
      return { ok: false, error: `"${String(email).slice(0, 60)}" is not a valid email.` };
    }
    if (!emails.includes(parsed.data)) emails.push(parsed.data);
  }

  if (existingCount + profileIds.length + emails.length > MAX_GUESTS) {
    return { ok: false, error: `Events can have at most ${MAX_GUESTS} guests.` };
  }

  return { ok: true, guests: { profileIds, emails } };
}
