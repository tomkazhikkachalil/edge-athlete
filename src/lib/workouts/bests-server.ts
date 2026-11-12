// ── The reader of an athlete's exercise history (server) ─────────────────────
// Training redesign PR 5 (Nov 11 2026). Bests are derived from the sets and
// never stored; what was slow was the READ — every session with every set's
// clips, 200 sessions a page. This is the narrow one: the exercise rows with
// five set columns and the four session fields the rules need, 1000 rows a
// page, and — for one exercise — only that exercise's rows, through the
// (profile_id, exercise_ref) index of migration 306.
//
// The reference is an INDEX FILTER, never the truth: a row is read when its
// stored reference matches OR is NULL (written by a deploy older than 306),
// and identity is recomputed here from the key and the name.
//
// Admin client; the ROUTE decides who may read. `visitor` narrows the rows to
// what a non-owner may ever receive: a completed session the owner has not
// hidden (269) and has decided (Post or Done reached).

import type { SupabaseClient } from '@supabase/supabase-js';
import { exerciseRefOf } from '@/lib/workout-config';
import type { EntryExercise, EntrySet } from './entries';
import type { ExerciseSession } from './exercise-list';
import { TESTED_MAX_SOURCES, testedMaxSessions, type TestedMaxRow } from './tested-max';

const PAGE = 1000;
const MAX_ROWS = 20_000;
const SELECT =
  'id, name, exercise_key, exercise_ref, position, client_id, category, session:workout_sessions!inner ( id, title, started_at, status, profile_hidden_at, share_decided_at ), sets:workout_sets ( set_number, reps, weight, weight_unit, duration_seconds, distance, distance_unit, completed_at )';

interface Row {
  id: string;
  name: string;
  exercise_key: string | null;
  position: number;
  client_id: string | null;
  category: EntryExercise['category'];
  session: { id: string; title: string | null; started_at: string };
  sets: Array<{ set_number: number; reps: number | null; weight: number | null; weight_unit: EntrySet['weightUnit']; duration_seconds: number | null; distance: number | null; distance_unit: EntrySet['distanceUnit']; completed_at: string | null }> | null;
}

export interface ExerciseReadOptions {
  /** A non-owner's read: shown and decided sessions only. */
  visitor: boolean;
  /** One exercise only (its identity). */
  ref?: string;
}

/** The athlete's completed sessions as exercises with their sets — every one, or one exercise's. */
export async function readExerciseSessions(admin: SupabaseClient, profileId: string, opts: ExerciseReadOptions): Promise<{ ok: true; sessions: ExerciseSession[] } | { ok: false }> {
  const bySession = new Map<string, ExerciseSession & { order: Array<{ position: number; exercise: EntryExercise }> }>();
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = admin.from('workout_exercises').select(SELECT).eq('profile_id', profileId).eq('session.status', 'completed').order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (opts.visitor) q = q.is('session.profile_hidden_at', null).not('session.share_decided_at', 'is', null);
    if (opts.ref) q = q.or(`exercise_ref.eq.${JSON.stringify(opts.ref)},exercise_ref.is.null`); // hardening-ok: the route admits a ref of letters, digits and underscores only
    const { data, error } = await q;
    if (error) {
      console.error('[workouts/bests] read failed:', error.message);
      return { ok: false };
    }
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      if (opts.ref && exerciseRefOf(r.exercise_key, r.name) !== opts.ref) continue;
      const exercise: EntryExercise = {
        clientId: r.client_id ?? r.id,
        name: r.name,
        exerciseKey: r.exercise_key,
        category: r.category,
        notes: null,
        sets: [...(r.sets ?? [])]
          .sort((a, b) => a.set_number - b.set_number)
          .map(s => ({ setNumber: s.set_number, reps: s.reps, weight: s.weight, weightUnit: s.weight_unit, durationSeconds: s.duration_seconds, distance: s.distance, distanceUnit: s.distance_unit, completedAt: s.completed_at, media: [] })),
      };
      const entry = bySession.get(r.session.id) ?? { id: r.session.id, startedAt: r.session.started_at, title: r.session.title || 'Workout', exercises: [], order: [] };
      entry.order.push({ position: r.position, exercise });
      bySession.set(r.session.id, entry);
    }
    if (rows.length < PAGE) break;
  }
  return {
    ok: true,
    sessions: [...bySession.values()].map(s => ({ id: s.id, startedAt: s.startedAt, title: s.title, exercises: s.order.sort((a, b) => a.position - b.position).map(o => o.exercise) })),
  };
}

/**
 * The athlete's TESTED MAXES as sessions (PR 6, tested-max.ts): the strength
 * rows of athlete_vitals the athlete typed in — never the copies the old
 * finish-step confirm wrote (`edge_vitals`). One exercise's when `ref` is
 * given. A failed read costs the tested maxes, never the bests: the sets
 * still fold.
 */
export async function readTestedMaxes(admin: SupabaseClient, profileId: string, ref?: string): Promise<ExerciseSession[]> {
  const { data, error } = await admin
    .from('athlete_vitals')
    .select('id, metric_key, metric_category, metric_label, value, unit, source, recorded_at')
    .eq('profile_id', profileId)
    .eq('metric_category', 'strength')
    .in('source', [...TESTED_MAX_SOURCES])
    .order('recorded_at', { ascending: false })
    .limit(2000);
  if (error) {
    console.error('[workouts/bests] tested maxes read failed:', error.message);
    return [];
  }
  return testedMaxSessions((data ?? []) as unknown as TestedMaxRow[], ref);
}

/** Everything a best is folded from: the logged sets and the tested maxes. */
export async function readBestsSources(admin: SupabaseClient, profileId: string, opts: ExerciseReadOptions): Promise<{ ok: true; sessions: ExerciseSession[]; workouts: ExerciseSession[] } | { ok: false }> {
  const [read, tested] = await Promise.all([readExerciseSessions(admin, profileId, opts), readTestedMaxes(admin, profileId, opts.ref)]);
  if (!read.ok) return { ok: false };
  return { ok: true, sessions: [...read.sessions, ...tested], workouts: read.sessions };
}
