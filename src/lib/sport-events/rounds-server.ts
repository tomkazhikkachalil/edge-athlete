/**
 * Rounds — the I/O half (Events program, PR 4: the snapshot and the
 * starts_on writer; PR 5 adds mintRound). The round's copy of the course
 * is taken from the catalog at save — WITH the stroke index — so a later
 * catalog edit never moves a played round. `starts_on` on the event is a
 * denormalised min(scheduled_on) with THIS module as its one writer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildRoundHoleData, ratingForTee, type CatalogHole } from './rounds';
import type { SportEventHoleDatum } from './types';
import type { RoundInput } from './validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const ROUND_COLUMNS =
  'id, sport_event_id, sequence, scheduled_on, course_id, course_name, tee, holes, starting_hole, course_rating, slope_rating, hole_data, status, created_at, updated_at';

export interface RoundSnapshot {
  scheduled_on: string;
  course_id: string | null;
  course_name: string;
  tee: string | null;
  holes: 9 | 18;
  starting_hole: 1 | 10;
  course_rating: number | null;
  slope_rating: number | null;
  hole_data: SportEventHoleDatum[] | null;
}

/** Resolve a round input against the catalog. Null = the picked course does not exist. */
export async function snapshotRound(admin: Admin, input: RoundInput): Promise<RoundSnapshot | null> {
  if (!input.course_id) {
    return {
      scheduled_on: input.scheduled_on,
      course_id: null,
      course_name: input.course_name ?? 'Course',
      tee: input.tee,
      holes: input.holes,
      starting_hole: input.starting_hole,
      course_rating: null,
      slope_rating: null,
      hole_data: null,
    };
  }
  const { data: course, error } = await admin
    .from('golf_courses')
    .select('id, name, hole_data, course_rating, slope_rating')
    .eq('id', input.course_id)
    .maybeSingle();
  if (error) {
    console.error('[sport-events] course read failed:', error);
    return null;
  }
  if (!course) return null;
  const rating = ratingForTee(course as { course_rating: Record<string, number> | null; slope_rating: Record<string, number> | null }, input.tee);
  return {
    scheduled_on: input.scheduled_on,
    course_id: course.id as string,
    course_name: input.course_name ?? (course.name as string),
    tee: input.tee,
    holes: input.holes,
    starting_hole: input.starting_hole,
    course_rating: rating.course_rating,
    slope_rating: rating.slope_rating,
    hole_data: buildRoundHoleData({ hole_data: (course.hole_data as CatalogHole[] | null) ?? null }, input.holes, input.starting_hole, input.tee),
  };
}

/** The event's starts_on = the earliest round. Pure. */
export function startsOnFor(rounds: Array<{ scheduled_on: string }>): string | null {
  let min: string | null = null;
  for (const r of rounds) if (min === null || r.scheduled_on < min) min = r.scheduled_on;
  return min;
}

/** Rewrite the event's starts_on from its rounds (the one writer). */
export async function writeStartsOn(admin: Admin, eventId: string): Promise<void> {
  const { data: rounds } = await admin.from('sport_event_rounds').select('scheduled_on').eq('sport_event_id', eventId).neq('status', 'cancelled');
  const startsOn = startsOnFor((rounds ?? []) as Array<{ scheduled_on: string }>);
  const { error } = await admin.from('sport_events').update({ starts_on: startsOn }).eq('id', eventId);
  if (error) console.error('[sport-events] starts_on write failed:', error);
}
