'use client';

import { useEffect, useState } from 'react';

// The org page's schedule section (119) — public upcoming events attached
// to this league/club. Renders nothing when the org has no scheduled
// events (the section is additive, like AffiliationSection).

interface OrgEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  category: string;
}

interface OrgUpcomingEventsProps {
  side: 'league' | 'club';
  orgId: string;
}

export default function OrgUpcomingEvents({ side, orgId }: OrgUpcomingEventsProps) {
  const [events, setEvents] = useState<OrgEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = side === 'league' ? `/api/leagues/${orgId}/events` : `/api/clubs/${orgId}/events`;
        const response = await fetch(base);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setEvents(data.events ?? []);
      } catch {
        /* additive section — a failed load renders nothing */
      }
    })();
    return () => { cancelled = true; };
  }, [side, orgId]);

  if (!events || events.length === 0) return null;

  const fmt = (ev: OrgEvent) => {
    const start = new Date(ev.starts_at);
    const date = start.toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    if (ev.all_day) {
      // S4: a golf league's play window is a multi-day all-day event
      // (end exclusive) — show the range, not the first day alone.
      const end = new Date(new Date(ev.ends_at).getTime() - 86_400_000);
      if (!Number.isNaN(end.getTime()) && end.getTime() - start.getTime() >= 12 * 3_600_000) {
        return `${date} – ${end.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`;
      }
      return date;
    }
    const time = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return `${date} · ${time}`;
  };

  return (
    <div className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-primary mb-4">Upcoming events</h2>
      <ul className="space-y-2">
        {events.map(ev => (
          <li key={ev.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-surface-muted">
            <i className="fas fa-calendar-days text-brand-fg mt-1 shrink-0" aria-hidden="true"></i>
            <div className="min-w-0">
              <p className="font-medium text-primary truncate">{ev.title}</p>
              <p className="text-sm text-muted truncate">
                {fmt(ev)}
                {ev.location ? ` · ${ev.location}` : ''}
              </p>
              {ev.description && (
                <p className="text-sm text-secondary mt-1 line-clamp-2">{ev.description}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
