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
  'id, sport_event_id, sequence, scheduled_on, course_id, course_name, tee, holes, starting_hole, course_rating, slope_rating, hole_data, status, name, starts_at, timezone, side1_score, side2_score, period, score_version, created_at, updated_at';

export interface RoundSnapshot {
  scheduled_on: string;
  /** 207 — an optional label ("Saturday", "Final round"). */
  name: string | null;
  course_id: string | null;
  course_name: string;
  tee: string | null;
  holes: 9 | 18;
  starting_hole: 1 | 10;
  course_rating: number | null;
  slope_rating: number | null;
  hole_data: SportEventHoleDatum[] | null;
  /** Phase 4 (215): the start (a team round's clock; optional on golf). */
  starts_at: string | null;
  /** Leftovers (221): the round's own IANA zone — the start is read on this clock; null = the viewer's. */
  timezone: string | null;
}

/** Resolve a round input against the catalog. Null = the picked course does not exist. */
export async function snapshotRound(admin: Admin, input: RoundInput): Promise<RoundSnapshot | null> {
  if (!input.course_id) {
    return {
      scheduled_on: input.scheduled_on,
      name: input.name ?? null,
      course_id: null,
      course_name: input.course_name ?? 'Course',
      tee: input.tee,
      holes: input.holes,
      starting_hole: input.starting_hole,
      course_rating: null,
      slope_rating: null,
      hole_data: null,
      starts_at: input.starts_at ?? null,
      timezone: input.timezone ?? null,
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
    name: input.name ?? null,
    course_id: course.id as string,
    course_name: input.course_name ?? (course.name as string),
    tee: input.tee,
    holes: input.holes,
    starting_hole: input.starting_hole,
    course_rating: rating.course_rating,
    slope_rating: rating.slope_rating,
    hole_data: buildRoundHoleData({ hole_data: (course.hole_data as CatalogHole[] | null) ?? null }, input.holes, input.starting_hole, input.tee),
    starts_at: input.starts_at ?? null,
    timezone: input.timezone ?? null,
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

/** Append a round (phase 2): the next sequence, the snapshot, then starts_on. Null on failure. */
export async function insertRound(admin: Admin, eventId: string, sequence: number, snapshot: RoundSnapshot): Promise<{ id: string } | null> {
  const { data, error } = await admin.from('sport_event_rounds').insert({ sport_event_id: eventId, sequence, ...snapshot }).select('id').single();
  if (error || !data) {
    console.error('[sport-events] round insert failed:', error);
    return null;
  }
  await writeStartsOn(admin, eventId);
  return { id: data.id as string };
}

/**
 * Remove a scheduled round (phase 2). Its announce post goes FIRST — 203
 * links the post with SET NULL, so deleting the row alone would leave an
 * orphan in the feed; the round row next (groups and members cascade);
 * then the later rounds move up one, lowest first, so the non-deferrable
 * UNIQUE never collides; then starts_on. The caller has already refused a
 * minted / non-scheduled round, so there is never a group_post to detach.
 */
export async function deleteRound(admin: Admin, eventId: string, round: { id: string; sequence: number }, renumber: Array<{ id: string; sequence: number }>): Promise<boolean> {
  const { error: postError } = await admin.from('posts').delete().eq('sport_event_round_id', round.id).is('group_post_id', null);
  if (postError) {
    console.error('[sport-events] round announce post delete failed:', postError);
    return false;
  }
  const { error } = await admin.from('sport_event_rounds').delete().eq('id', round.id).eq('sport_event_id', eventId);
  if (error) {
    console.error('[sport-events] round delete failed:', error);
    return false;
  }
  for (const r of renumber) {
    const { error: seqError } = await admin.from('sport_event_rounds').update({ sequence: r.sequence }).eq('id', r.id);
    if (seqError) console.error('[sport-events] round renumber failed:', seqError);
  }
  await writeStartsOn(admin, eventId);
  return true;
}
