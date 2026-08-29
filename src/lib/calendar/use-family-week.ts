'use client';

// The family calendar fetch, lifted out of GuardianWeekStrip (Wave 5): the
// hub now needs the same merged event set twice — the week strip AND the
// per-child "Next:" payoff line — so ONE hook fetches a 14-day window (the
// athlete page's established middle ground; the strip still renders only its
// 7 days) and both consumers read it. Per-child requests via
// Promise.allSettled — one child's failure never blanks the surface
// (athlete-page informational-section doctrine).

import { useEffect, useMemo, useState } from 'react';
import { FEATURE_FLAGS } from '@/lib/features';
import { mergeLayeredEvents } from '@/lib/calendar/layers';
import type { EventListItem } from '@/components/calendar/types';

export interface FamilyWeekAthlete {
  id: string;
  name: string;
}

/** Event tagged with the roster children it belongs to (deduped by id —
 *  siblings sharing an event is one commitment, not a conflict). */
export type FamilyEvent = EventListItem & { childIds: string[] };

const WINDOW_DAYS = 14;

export function useFamilyWeek(athletes: FamilyWeekAthlete[]): {
  events: FamilyEvent[];
  loaded: boolean;
  failed: boolean;
  retry: () => void;
} {
  const [events, setEvents] = useState<FamilyEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refetchKey, setRefetchKey] = useState(0);

  useEffect(() => {
    if (!FEATURE_FLAGS.FEATURE_CALENDAR || athletes.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const from = new Date();
        from.setHours(0, 0, 0, 0);
        const to = new Date(from.getTime() + WINDOW_DAYS * 86_400_000);
        const results = await Promise.allSettled(
          athletes.map(async a => {
            const res = await fetch(
              `/api/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(
                to.toISOString()
              )}&targetProfileId=${a.id}`
            );
            if (!res.ok) throw new Error(`status ${res.status}`);
            const data = await res.json();
            return { childId: a.id, events: (data.events ?? []) as EventListItem[] };
          })
        );
        if (cancelled) return;
        // Shared merge core (calendar round): child sets drop overlay items
        // and cancelled events — real commitments only, as before.
        const sets = results
          .filter((r): r is PromiseFulfilledResult<{ childId: string; events: EventListItem[] }> => r.status === 'fulfilled')
          .map(r => ({ personId: r.value.childId, events: r.value.events }));
        setEvents(
          mergeLayeredEvents(sets).map(({ personIds, ...ev }) => ({ ...ev, childIds: personIds }))
        );
        setFailed(sets.length === 0);
        setLoaded(true);
      } catch (e) {
        if (cancelled) return;
        console.error('[FAMILY WEEK] load failed:', e);
        setFailed(true);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athletes, refetchKey]);

  return useMemo(
    () => ({
      events,
      loaded,
      failed,
      retry: () => {
        setFailed(false);
        setLoaded(false);
        setRefetchKey(k => k + 1);
      },
    }),
    [events, loaded, failed]
  );
}
