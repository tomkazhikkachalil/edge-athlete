import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVITY_TYPE_DEFS, isActivityType } from '@/lib/activities/catalog';
import { getSportColor, getSportName } from '@/lib/config/sports-config';
import { getStatSchema, isStatLineData } from '@/lib/sports/stat-schemas';
import {
  activityAttachable,
  activityPlate,
  attachKey,
  attachRefOf,
  roundAttachable,
  roundPlate,
  sortAttachable,
  statLineAttachable,
  statLinePlate,
  workoutAttachable,
  workoutPlate,
  type AttachRef,
  type HoleSource,
  type SetSource,
  type StatPlateData,
} from './attachment';

// ── A post's attached activity: the ONE reader of its sources (321) ──────────
// The rules live in attachment.ts (pure); this file reads the rows. Three
// doors:
//   listAttachable   the composer's picker — the author's recent activities
//   checkAttachment  the write gate — the author owns it and it may be attached
//   platesFor        the read path — plates for a page of posts, batched
// A plate is built ONLY from a source that belongs to the post's own author
// and may still be attached: a round hidden after the post was made, an
// activity turned Only me, a deleted workout — the plate is gone on the next
// read, the post stays.
//
// The caller passes the service-role client (the routes authorise first; the
// feed's own gate decided the viewer may see the POST — the plate is the
// post's content, by Tom's rule: attaching shows this summary to everyone who
// can see the post).

type Db = SupabaseClient;

const ROUND_COLS = 'id, profile_id, date, course, holes, par, gross_score, is_complete, profile_hidden_at';
const WORKOUT_COLS = 'id, profile_id, title, status, started_at, duration_seconds, profile_hidden_at, workout_exercises(name, position, workout_sets(set_number, reps, weight, weight_unit))';
const ACTIVITY_COLS = 'id, profile_id, activity_type, name, started_at, distance_m, moving_s, elapsed_s, only_me';
const STAT_POST_COLS = 'id, profile_id, sport_key, status, stats_data, created_at';

interface RoundRow { id: string; profile_id: string; date: string | null; course: string; holes: number | null; par: number | null; gross_score: number | null; is_complete: boolean | null; profile_hidden_at: string | null }
interface WorkoutRow {
  id: string; profile_id: string; title: string | null; status: string | null; started_at: string | null; duration_seconds: number | null; profile_hidden_at: string | null;
  workout_exercises: Array<{ name: string; position: number | null; workout_sets: Array<{ set_number: number | null; reps: number | null; weight: number | string | null; weight_unit: string | null }> | null }> | null;
}
interface ActivityRow { id: string; profile_id: string; activity_type: string; name: string; started_at: string | null; distance_m: number | string | null; moving_s: number | null; elapsed_s: number | null; only_me: boolean | null }
interface StatPostRow { id: string; profile_id: string; sport_key: string | null; status: string | null; stats_data: unknown; created_at: string }

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function plateOfRound(row: RoundRow, holes: readonly HoleSource[]): StatPlateData | null {
  if (!roundAttachable(row)) return null;
  return roundPlate({ id: row.id, date: row.date, course: row.course, holes: row.holes, par: row.par, gross_score: row.gross_score as number }, holes);
}

function plateOfWorkout(row: WorkoutRow): StatPlateData | null {
  if (!workoutAttachable(row)) return null;
  const sets: SetSource[] = [];
  for (const exercise of [...(row.workout_exercises ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    for (const set of exercise.workout_sets ?? []) sets.push({ exercise: exercise.name, weight: num(set.weight), weight_unit: set.weight_unit, reps: set.reps });
  }
  return workoutPlate({ id: row.id, title: row.title, started_at: row.started_at, duration_seconds: row.duration_seconds }, sets);
}

function plateOfActivity(row: ActivityRow): StatPlateData | null {
  if (!activityAttachable(row)) return null;
  const def = isActivityType(row.activity_type) ? ACTIVITY_TYPE_DEFS[row.activity_type] : null;
  return activityPlate({
    id: row.id,
    name: row.name,
    label: def?.label ?? 'Activity',
    started_at: row.started_at,
    distance_m: num(row.distance_m),
    moving_s: row.moving_s,
    elapsed_s: row.elapsed_s,
    paceStyle: def?.paceStyle ?? 'pace',
  });
}

function plateOfStatPost(row: StatPostRow): StatPlateData | null {
  const data = row.stats_data;
  if (!isStatLineData(data)) return null;
  if (!statLineAttachable({ status: row.status, stats_type: data.type })) return null;
  const sportKey = row.sport_key ?? data.sport_key;
  const schema = getStatSchema(sportKey);
  if (!schema) return null;
  const stats = data.stats ?? {};
  return statLinePlate({
    id: row.id,
    sport: getSportName(sportKey),
    colour: getSportColor(sportKey),
    date: data.date ?? row.created_at,
    opponent: data.opponent ?? null,
    heroLabel: schema.heroStat.label,
    heroValue: schema.heroStat.compute(stats),
    line: schema.headline(stats),
  });
}

async function holesByRound(db: Db, roundIds: string[]): Promise<Map<string, HoleSource[]>> {
  const out = new Map<string, HoleSource[]>();
  if (roundIds.length === 0) return out;
  const { data } = await db.from('golf_holes').select('round_id, hole_number, par, strokes').in('round_id', roundIds);
  for (const row of (data ?? []) as Array<HoleSource & { round_id: string }>) {
    const list = out.get(row.round_id) ?? [];
    list.push({ hole_number: row.hole_number, par: row.par, strokes: row.strokes });
    out.set(row.round_id, list);
  }
  return out;
}

/** How many of each kind the picker reads before merging. */
const PER_KIND = 12;
/** The picker's length. */
export const ATTACHABLE_LIMIT = 30;

/** The author's recent activities that may be attached, newest first. */
export async function listAttachable(db: Db, profileId: string): Promise<StatPlateData[]> {
  const [rounds, workouts, activities, statPosts] = await Promise.all([
    db.from('golf_rounds').select(ROUND_COLS).eq('profile_id', profileId).eq('is_complete', true).is('profile_hidden_at', null).not('gross_score', 'is', null).order('date', { ascending: false }).limit(PER_KIND),
    db.from('workout_sessions').select(WORKOUT_COLS).eq('profile_id', profileId).eq('status', 'completed').is('profile_hidden_at', null).order('started_at', { ascending: false }).limit(PER_KIND),
    db.from('activities').select(ACTIVITY_COLS).eq('profile_id', profileId).eq('only_me', false).order('started_at', { ascending: false }).limit(PER_KIND),
    db.from('posts').select(STAT_POST_COLS).eq('profile_id', profileId).eq('status', 'published').eq('stats_data->>type', 'stat_line').order('created_at', { ascending: false }).limit(PER_KIND),
  ]);
  const plates: StatPlateData[] = [];
  // The rounds' cards ride along: the composer's preview draws the same plate the feed will.
  const roundRows = (rounds.data ?? []) as RoundRow[];
  const holes = await holesByRound(db, roundRows.map(r => r.id));
  for (const row of roundRows) { const p = plateOfRound(row, holes.get(row.id) ?? []); if (p) plates.push(p); }
  for (const row of (workouts.data ?? []) as unknown as WorkoutRow[]) { const p = plateOfWorkout(row); if (p) plates.push(p); }
  for (const row of (activities.data ?? []) as ActivityRow[]) { const p = plateOfActivity(row); if (p) plates.push(p); }
  for (const row of (statPosts.data ?? []) as StatPostRow[]) { const p = plateOfStatPost(row); if (p) plates.push(p); }
  return sortAttachable(plates).slice(0, ATTACHABLE_LIMIT);
}

/** One source's plate for `ownerId`, or null: not theirs, not found, or not attachable. */
async function plateForOwner(db: Db, ref: AttachRef, ownerId: string): Promise<StatPlateData | null> {
  const found = (await readPlates(db, [ref])).get(attachKey(ref));
  return found && found.ownerId === ownerId ? found.plate : null;
}

/** The write gate: the author owns the source and it may be attached. */
export async function checkAttachment(db: Db, ref: AttachRef, authorId: string): Promise<{ ok: true; plate: StatPlateData } | { ok: false; error: string }> {
  const plate = await plateForOwner(db, ref, authorId);
  if (!plate) return { ok: false, error: 'That activity cannot be attached' };
  return { ok: true, plate };
}

/** Plates for sources that may be attached, each with the profile that OWNS the source (the caller compares it with the post's author). Batched: one read per kind (two for rounds). */
async function readPlates(db: Db, wanted: readonly AttachRef[]): Promise<Map<string, { plate: StatPlateData; ownerId: string }>> {
  const out = new Map<string, { plate: StatPlateData; ownerId: string }>();
  if (wanted.length === 0) return out;
  const ids = (kind: AttachRef['kind']) => [...new Set(wanted.filter(w => w.kind === kind).map(w => w.id))];
  const roundIds = ids('round');
  const workoutIds = ids('workout');
  const activityIds = ids('activity');
  const statIds = ids('stat_line');
  const [rounds, holes, workouts, activities, statPosts] = await Promise.all([
    roundIds.length ? db.from('golf_rounds').select(ROUND_COLS).in('id', roundIds) : null,
    holesByRound(db, roundIds),
    workoutIds.length ? db.from('workout_sessions').select(WORKOUT_COLS).in('id', workoutIds) : null,
    activityIds.length ? db.from('activities').select(ACTIVITY_COLS).in('id', activityIds) : null,
    statIds.length ? db.from('posts').select(STAT_POST_COLS).in('id', statIds) : null,
  ]);
  const keep = (kind: AttachRef['kind'], row: { id: string; profile_id: string }, plate: StatPlateData | null) => {
    if (plate) out.set(attachKey({ kind, id: row.id }), { plate, ownerId: row.profile_id });
  };
  for (const row of (rounds?.data ?? []) as RoundRow[]) keep('round', row, plateOfRound(row, holes.get(row.id) ?? []));
  for (const row of (workouts?.data ?? []) as unknown as WorkoutRow[]) keep('workout', row, plateOfWorkout(row));
  for (const row of (activities?.data ?? []) as ActivityRow[]) keep('activity', row, plateOfActivity(row));
  for (const row of (statPosts?.data ?? []) as StatPostRow[]) keep('stat_line', row, plateOfStatPost(row));
  return out;
}

/** The read path: each post's plate by POST id (a post without one, or whose source is gone or hidden, has no entry). */
export async function platesFor(db: Db, posts: ReadonlyArray<Record<string, unknown>>): Promise<Map<string, StatPlateData>> {
  const refs: Array<{ postId: string; ref: AttachRef; ownerId: string }> = [];
  for (const post of posts) {
    const ref = attachRefOf(post);
    if (ref && typeof post.id === 'string' && typeof post.profile_id === 'string') refs.push({ postId: post.id, ref, ownerId: post.profile_id });
  }
  const out = new Map<string, StatPlateData>();
  if (refs.length === 0) return out;
  const plates = await readPlates(db, refs.map(r => r.ref));
  for (const { postId, ref, ownerId } of refs) {
    const found = plates.get(attachKey(ref));
    if (found && found.ownerId === ownerId) out.set(postId, found.plate);
  }
  return out;
}
