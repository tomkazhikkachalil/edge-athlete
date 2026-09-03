'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { FEATURE_FLAGS } from '@/lib/features';

export interface HouseholdPerson {
  id: string;
  name: string;
}

/**
 * The viewer's household roster for a layered calendar (guardian OR view-only
 * seats; supervised, non-deleted — hub-strip semantics). `null` until the
 * first response; `[]` for a solo viewer, when the flag is off, and on
 * failure — the caller's own calendar is never hostage to this fetch.
 * Fetched once per signed-in user, never on range navigation. Extracted from
 * CalendarPage so the feed sidebar widget shows the same people.
 */
export function useHouseholdRoster(): HouseholdPerson[] | null {
  const { user } = useAuth();
  const [people, setPeople] = useState<HouseholdPerson[] | null>(null);
  useEffect(() => {
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || !user?.id || people !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guardian/athletes', { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) {
          const athletes = (data.athletes ?? []) as {
            id: string;
            first_name: string | null;
            display_name: string | null;
            supervision_state: string | null;
            deletion_requested_at: string | null;
          }[];
          setPeople(
            athletes
              .filter(a => a.supervision_state === 'supervised' && !a.deletion_requested_at)
              .map(a => ({ id: a.id, name: a.first_name || a.display_name || 'Athlete' }))
          );
        }
      } catch {
        if (!cancelled) setPeople([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, people]);
  return people;
}
