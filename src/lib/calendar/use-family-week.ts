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
        const merged = new Map<string, FamilyEvent>();
        let anyOk = false;
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          anyOk = true;
          for (const ev of result.value.events) {
            // Real commitments only: the activity overlay has no my_status
            // key at all (established filter), and cancelled events are
            // history, not schedule.
            if (ev.my_status === undefined || ev.status === 'cancelled') continue;
            const existing = merged.get(ev.id);
            if (existing) {
              if (!existing.childIds.includes(result.value.childId)) {
                existing.childIds.push(result.value.childId);
              }
            } else {
              merged.set(ev.id, { ...ev, childIds: [result.value.childId] });
            }
          }
        }
        setEvents([...merged.values()]);
        setFailed(!anyOk);
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
