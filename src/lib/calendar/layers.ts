// Layered multi-person calendar (calendar round, PR 3) — pure merge/filter
// core for overlaying household schedules on /calendar, plus the stable
// per-person color channel. Person color is a DOT/EDGE, never the fill:
// category owns the fill (categories.ts) and the palettes collide.

import type { EventListItem } from '@/components/calendar/types';

/** Sentinel personId for the viewer's own events ("You" chip). */
export const ME = 'me';

export type LayeredEvent = EventListItem & { personIds: string[] };

/**
 * Dedupe per-person result sets by event id; the FIRST set an event appears
 * in wins field-wise, so callers put the viewer's own set first — my_status
 * must be the CALLER's response (a guardian's accepted event must not render
 * dashed-pending because the child hasn't replied). personIds union across
 * sets. Non-own sets drop activity-overlay items (my_status === undefined —
 * the established discriminant) and cancelled events, mirroring
 * use-family-week: a child's history is not the guardian's schedule; the
 * caller's own set keeps everything (their overlay previews in place).
 */
export function mergeLayeredEvents(
  results: { personId: string; events: EventListItem[] }[]
): LayeredEvent[] {
  const merged = new Map<string, LayeredEvent>();
  for (const { personId, events } of results) {
    for (const ev of events) {
      if (personId !== ME && (ev.my_status === undefined || ev.status === 'cancelled')) continue;
      const existing = merged.get(ev.id);
      if (existing) {
        if (!existing.personIds.includes(personId)) existing.personIds.push(personId);
      } else {
        merged.set(ev.id, { ...ev, personIds: [personId] });
      }
    }
  }
  return [...merged.values()];
}

/**
 * Chip-filter semantics: AND across groups, OR within a group, and an EMPTY
 * selection deactivates its group (chips filter down, they never start from
 * nothing). Events without personIds (a non-guardian's plain calendar) pass
 * the people group untouched.
 */
export function filterLayeredEvents(
  events: LayeredEvent[],
  sel: { people: ReadonlySet<string>; categories: ReadonlySet<string> }
): LayeredEvent[] {
  return events.filter(ev => {
    if (sel.people.size > 0 && ev.personIds.length > 0 &&
        !ev.personIds.some(id => sel.people.has(id))) {
      return false;
    }
    if (sel.categories.size > 0 && !sel.categories.has(ev.category)) return false;
    return true;
  });
}

/** Static per-person dot classes (never interpolate Tailwind). The first
 *  five match the retired roster-order CHILD_DOTS palette. */
export const PERSON_DOT_CLASSES = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-teal-500',
];

/**
 * Stable per-person dot class: the id's position in the SORTED roster (not
 * arrival order, which differs between the hub strip and /calendar — the
 * two surfaces must agree). Sorted-index is collision-free up to the
 * palette size, where a pure id-hash would give two kids the same color in
 * ~half of three-child households. An id missing from the roster (stale
 * persisted filter, race) degrades to a char-code hash instead of throwing.
 */
export function personDotClass(profileId: string, rosterIds: readonly string[]): string {
  const idx = [...new Set(rosterIds)].sort().indexOf(profileId);
  if (idx >= 0) return PERSON_DOT_CLASSES[idx % PERSON_DOT_CLASSES.length];
  let h = 0;
  for (let i = 0; i < profileId.length; i++) {
    h = (h * 31 + profileId.charCodeAt(i)) >>> 0;
  }
  return PERSON_DOT_CLASSES[h % PERSON_DOT_CLASSES.length];
}
