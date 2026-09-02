// ── The site's ICS feed (phase 6e S4) — pure, node-tested ──────────────────
// A public golf club or league's calendar anyone can subscribe to: the
// org's public events over the coming year plus its golf leagues' play
// windows as all-day, multi-day VEVENTs — except rounds a mirror event
// already covers (they arrive as events; never twice). Viewer-independent
// by construction: no auth, no cookies, the same bytes for everyone. The
// route caches it like every public reader.

import { buildCalendar, buildVEvent } from '@/lib/calendar/ics';
import type { OrgEvent } from '@/lib/calendar/org-events-server';

export interface FeedRound {
  id: string;
  competitionName: string;
  round: string | null;
  holes: number;
  playFrom: string;
  playTo: string;
  courseName: string | null;
  eventId: string | null;
}

const dayMs = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

export function buildSiteFeed(input: {
  name: string;
  events: OrgEvent[];
  rounds: FeedRound[];
  dtstampMs: number;
}): string {
  const vevents: string[] = [];
  // Dedupe against the events the feed ACTUALLY carries: an open round's
  // mirror event started days ago and is no longer "upcoming", so it is
  // absent from `events` — the round must still reach the feed.
  const carried = new Set(input.events.map(e => e.id));
  for (const e of input.events) {
    const startMs = Date.parse(e.starts_at);
    const endMs = e.ends_at ? Date.parse(e.ends_at) : startMs + 3_600_000;
    if (!Number.isFinite(startMs)) continue;
    vevents.push(
      buildVEvent({
        uid: `event-${e.id}@edge-athlete`,
        dtstampMs: input.dtstampMs,
        startMs,
        endMs: Number.isFinite(endMs) ? endMs : startMs + 3_600_000,
        allDay: !!e.all_day,
        timezone: e.timezone || 'UTC',
        title: e.title,
        description: e.description,
        location: e.location,
      })
    );
  }
  for (const r of input.rounds) {
    if (r.eventId && carried.has(r.eventId)) continue; // the mirror event is already in `events`
    // VALUE=DATE math is zone-independent when the instants are UTC
    // midnights and the zone is UTC — the dates come out verbatim.
    vevents.push(
      buildVEvent({
        uid: `contest-${r.id}@edge-athlete`,
        dtstampMs: input.dtstampMs,
        startMs: dayMs(r.playFrom),
        endMs: dayMs(r.playTo) + 86_400_000,
        allDay: true,
        timezone: 'UTC',
        title: `${r.round ?? 'Round'} — ${r.competitionName}`,
        description: `${r.holes} holes${r.courseName ? ` at ${r.courseName}` : ''} · play any day of the window`,
        location: r.courseName,
      })
    );
  }
  return buildCalendar(vevents, { name: input.name, feedHints: true });
}
