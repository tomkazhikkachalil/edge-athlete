/**
 * Workout entries payload — the exercises+sets snapshot exchanged between
 * the editor and the API (PUT /api/workouts/[id]/entries and manual POST).
 * Validation mirrors the DB CHECK constraints so Postgres errors are never
 * the first line of defense.
 *
 * Workout screen program (Oct 12 2026, migration 260): an exercise carries a
 * STABLE `clientId` (every save is a whole-snapshot replace, so the row id is
 * re-minted each time; the editor mints the client id once and it rides
 * every save — the clip stash, the cards' keys and a rename hang on it), the
 * optional GROUP fields of a superset or circuit (denormalized on every
 * member; a member's sets are its rounds), and a set carries the rest taken
 * before it. Every new field is optional on the way in: a payload without
 * them (an old client, an old draft, a routine) is the pre-260 workout.
 */

import { isUuid } from '@/lib/uuid';
import { newId } from '@/lib/ids';

export interface SetMedia {
  url: string;
  type: 'image' | 'video';
}

export interface EntrySet {
  setNumber: number;
  reps: number | null;
  weight: number | null;
  weightUnit: 'lbs' | 'kg' | null;
  durationSeconds: number | null;
  distance: number | null;
  distanceUnit: 'mi' | 'km' | 'm' | 'yd' | null;
  completedAt: string | null; // ISO timestamp
  /** Photos/videos attached to this set (form checks, lift clips). */
  media: SetMedia[];
  /** The rest taken BEFORE this set, seconds (260; the rest timer). Never "data". */
  restSeconds?: number | null;
}

export type ExerciseGroupKind = 'superset' | 'circuit';
export const GROUP_KINDS = ['superset', 'circuit'] as const;
/** Rounds of a group: the routines' target_sets cap (079), ONE number everywhere. */
export const MAX_GROUP_ROUNDS = 10;

export interface EntryExercise {
  /** The STABLE id (260): minted once by the editor, carried through every save. */
  clientId: string;
  name: string;
  exerciseKey: string | null; // catalog key; null = custom
  category: 'strength' | 'cardio' | 'mobility' | 'other';
  notes: string | null;
  sets: EntrySet[];
  /** A superset or circuit (260): the members share `groupId`, consecutive;
   *  kind and rounds are repeated on every member. Absent = a single exercise. */
  groupId?: string | null;
  groupKind?: ExerciseGroupKind | null;
  groupRounds?: number | null;
}

export const MAX_EXERCISES = 40;
export const MAX_SETS_PER_EXERCISE = 50;
export const MAX_MEDIA_PER_SET = 4;

/** An empty set — the one builder every seed and the editor share. */
export function emptyEntrySet(setNumber: number): EntrySet {
  return { setNumber, reps: null, weight: null, weightUnit: null, durationSeconds: null, distance: null, distanceUnit: null, completedAt: null, media: [], restSeconds: null };
}

/** Every exercise gets a client id when it has none (an old draft, a routine, an old client's payload). The same array when nothing was missing. */
export function ensureClientIds<E extends { clientId?: string | null }>(exercises: E[], mint: () => string = newId): Array<E & { clientId: string }> {
  let changed = false;
  const out = exercises.map(e => {
    if (typeof e.clientId === 'string' && e.clientId) return e as E & { clientId: string };
    changed = true;
    return { ...e, clientId: mint() };
  });
  return changed ? out : (exercises as Array<E & { clientId: string }>);
}

/**
 * The group invariants, HEALED rather than refused (a 400 would wedge the
 * editor's autosave loop, which re-sends the same snapshot): a singleton
 * group is ungrouped; members are made consecutive at the first member's
 * place; kind is the first member's; rounds = max(declared, the longest
 * member's sets), capped at MAX_GROUP_ROUNDS; every member is padded with
 * empty sets up to the rounds (never truncated — that would be data loss).
 * Returns the same array when nothing needed healing.
 */
export function healGroups<E extends EntryExercise>(exercises: E[]): E[] {
  const groups = new Map<string, number[]>();
  exercises.forEach((e, i) => {
    if (e.groupId) groups.set(e.groupId, [...(groups.get(e.groupId) ?? []), i]);
  });
  if (groups.size === 0) {
    const stripped = exercises.some(e => e.groupKind || e.groupRounds);
    return stripped ? exercises.map(e => (e.groupKind || e.groupRounds ? { ...e, groupId: null, groupKind: null, groupRounds: null } : e)) : exercises;
  }
  let changed = false;
  const byIndex: Array<E | null> = exercises.map(e => e);
  const insertAfter = new Map<number, E[]>();
  for (const [groupId, idxs] of groups) {
    if (idxs.length < 2) {
      const i = idxs[0];
      byIndex[i] = { ...exercises[i], groupId: null, groupKind: null, groupRounds: null };
      changed = true;
      continue;
    }
    const members = idxs.map(i => exercises[i]);
    const kind: ExerciseGroupKind = members.find(m => m.groupKind === 'superset' || m.groupKind === 'circuit')?.groupKind ?? 'circuit';
    const declared = Math.max(0, ...members.map(m => (typeof m.groupRounds === 'number' && Number.isFinite(m.groupRounds) ? Math.floor(m.groupRounds) : 0)));
    const longest = Math.max(...members.map(m => m.sets.length));
    const rounds = Math.min(MAX_GROUP_ROUNDS, Math.max(1, declared, longest));
    const healed = members.map(m => {
      const sets = m.sets.length >= rounds ? m.sets : [...m.sets, ...Array.from({ length: rounds - m.sets.length }, (_, k) => emptyEntrySet(m.sets.length + k + 1))];
      const same = m.groupKind === kind && m.groupRounds === rounds && sets === m.sets;
      if (!same) changed = true;
      return same ? m : ({ ...m, groupId, groupKind: kind, groupRounds: rounds, sets } as E);
    });
    // Consecutive: the members take the first member's place, in their order.
    const first = idxs[0];
    const consecutive = idxs.every((i, k) => i === first + k);
    if (!consecutive) changed = true;
    byIndex[first] = healed[0];
    for (let k = 1; k < idxs.length; k++) {
      if (consecutive) byIndex[idxs[k]] = healed[k];
      else {
        byIndex[idxs[k]] = null;
        insertAfter.set(first, [...(insertAfter.get(first) ?? []), healed[k]]);
      }
    }
  }
  if (!changed) return exercises;
  const out: E[] = [];
  byIndex.forEach((e, i) => {
    if (e) out.push(e);
    for (const extra of insertAfter.get(i) ?? []) out.push(extra);
  });
  return out;
}

const MEDIA_TYPES = ['image', 'video'] as const;

/**
 * Only first-party storage URLs (or same-origin paths) may be persisted:
 * set media renders in raw <video>/<a> tags with no host gate, so an
 * arbitrary https URL here would make every viewer's browser fetch it.
 */
export function isAllowedMediaUrl(url: string): boolean {
  if (url.length === 0 || url.length > 2048) return false;
  // A media-proxy path is a VIEW of a stored file, never the stored value:
  // the sweep and the deletion engine parse `public/uploads/…`, so a stored
  // proxied path made the file look unused (Oct 4 2026). The server heals a
  // proxied path back to its storage URL BEFORE validating (entries-heal-
  // server.ts); one that reaches here is unverifiable and refused by name.
  if (url.startsWith('/api/media/')) return false;
  // Same-origin path; '//host' would be protocol-relative, not same-origin.
  if (url.startsWith('/')) return !url.startsWith('//');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname.endsWith('.supabase.co') || parsed.hostname.endsWith('.supabase.in')) return true;
  try {
    return parsed.hostname === new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
  } catch {
    return false;
  }
}

function validateSetMedia(raw: unknown): { ok: true; media: SetMedia[] } | { ok: false; error: string } {
  // Absent = no media (back-compat with pre-046 snapshots and drafts)
  if (raw === undefined || raw === null) return { ok: true, media: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'media must be an array' };
  if (raw.length > MAX_MEDIA_PER_SET) {
    return { ok: false, error: `too many media items (max ${MAX_MEDIA_PER_SET})` };
  }
  const media: SetMedia[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      return { ok: false, error: 'malformed media item' };
    }
    const m = item as Record<string, unknown>;
    if (typeof m.url !== 'string' || !isAllowedMediaUrl(m.url)) {
      return { ok: false, error: 'invalid media URL' };
    }
    if (!MEDIA_TYPES.includes(m.type as typeof MEDIA_TYPES[number])) {
      return { ok: false, error: 'invalid media type' };
    }
    media.push({ url: m.url, type: m.type as SetMedia['type'] });
  }
  return { ok: true, media };
}

export const CATEGORIES = ['strength', 'cardio', 'mobility', 'other'] as const;
const WEIGHT_UNITS = ['lbs', 'kg'] as const;
const DISTANCE_UNITS = ['mi', 'km', 'm', 'yd'] as const;

function isFiniteInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

function nullOr(v: unknown, check: (x: unknown) => boolean): boolean {
  return v === null || check(v);
}

function validateSet(raw: unknown, index: number): { ok: true; set: EntrySet } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, error: `Set ${index + 1} is malformed` };
  }
  const s = raw as Record<string, unknown>;
  if (!isFiniteInRange(s.setNumber, 1, 99)) {
    return { ok: false, error: `Set ${index + 1}: set number out of range` };
  }
  if (!nullOr(s.reps, v => isFiniteInRange(v, 0, 1000))) {
    return { ok: false, error: `Set ${index + 1}: reps out of range` };
  }
  if (!nullOr(s.weight, v => isFiniteInRange(v, 0, 5000))) {
    return { ok: false, error: `Set ${index + 1}: weight out of range` };
  }
  if (!nullOr(s.weightUnit, v => WEIGHT_UNITS.includes(v as typeof WEIGHT_UNITS[number]))) {
    return { ok: false, error: `Set ${index + 1}: invalid weight unit` };
  }
  if (!nullOr(s.durationSeconds, v => isFiniteInRange(v, 0, 86400))) {
    return { ok: false, error: `Set ${index + 1}: duration out of range` };
  }
  if (!nullOr(s.distance, v => isFiniteInRange(v, 0, 1000000))) {
    return { ok: false, error: `Set ${index + 1}: distance out of range` };
  }
  if (!nullOr(s.distanceUnit, v => DISTANCE_UNITS.includes(v as typeof DISTANCE_UNITS[number]))) {
    return { ok: false, error: `Set ${index + 1}: invalid distance unit` };
  }
  if (!nullOr(s.completedAt, v => typeof v === 'string' && !Number.isNaN(Date.parse(v)))) {
    return { ok: false, error: `Set ${index + 1}: invalid completion time` };
  }
  const mediaResult = validateSetMedia(s.media);
  if (!mediaResult.ok) {
    return { ok: false, error: `Set ${index + 1}: ${mediaResult.error}` };
  }
  // 260: the rest before the set — optional on the way in (absent = none).
  if (s.restSeconds !== undefined && !nullOr(s.restSeconds, v => isFiniteInRange(v, 0, 86400))) {
    return { ok: false, error: `Set ${index + 1}: rest out of range` };
  }
  return {
    ok: true,
    set: {
      setNumber: s.setNumber as number,
      reps: (s.reps as number | null) ?? null,
      weight: (s.weight as number | null) ?? null,
      weightUnit: (s.weightUnit as EntrySet['weightUnit']) ?? null,
      durationSeconds: (s.durationSeconds as number | null) ?? null,
      distance: (s.distance as number | null) ?? null,
      distanceUnit: (s.distanceUnit as EntrySet['distanceUnit']) ?? null,
      completedAt: (s.completedAt as string | null) ?? null,
      media: mediaResult.media,
      restSeconds: typeof s.restSeconds === 'number' ? Math.round(s.restSeconds) : null,
    },
  };
}

export function validateEntriesPayload(
  raw: unknown
): { ok: true; exercises: EntryExercise[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'Exercises must be an array' };
  }
  if (raw.length > MAX_EXERCISES) {
    return { ok: false, error: `Too many exercises (max ${MAX_EXERCISES})` };
  }

  const exercises: EntryExercise[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (typeof e !== 'object' || e === null) {
      return { ok: false, error: `Exercise ${i + 1} is malformed` };
    }
    const ex = e as Record<string, unknown>;
    if (typeof ex.name !== 'string' || ex.name.trim().length === 0 || ex.name.trim().length > 80) {
      return { ok: false, error: `Exercise ${i + 1}: name must be 1–80 characters` };
    }
    // 260: the stable id — absent is minted (an old client); present must be a
    // uuid and unique in the snapshot (a duplicate would be a 23505 inside the
    // replace, a 500 that wedges the autosave).
    if (ex.clientId !== undefined && ex.clientId !== null && (typeof ex.clientId !== 'string' || !isUuid(ex.clientId))) {
      return { ok: false, error: `Exercise ${i + 1}: invalid exercise id` };
    }
    if (typeof ex.clientId === 'string' && seenIds.has(ex.clientId)) {
      return { ok: false, error: `Exercise ${i + 1}: duplicate exercise id` };
    }
    if (typeof ex.clientId === 'string') seenIds.add(ex.clientId);
    if (ex.groupId !== undefined && ex.groupId !== null && (typeof ex.groupId !== 'string' || !isUuid(ex.groupId))) {
      return { ok: false, error: `Exercise ${i + 1}: invalid group id` };
    }
    if (ex.groupKind !== undefined && ex.groupKind !== null && !GROUP_KINDS.includes(ex.groupKind as ExerciseGroupKind)) {
      return { ok: false, error: `Exercise ${i + 1}: invalid group kind` };
    }
    if (ex.groupRounds !== undefined && ex.groupRounds !== null && !isFiniteInRange(ex.groupRounds, 1, MAX_GROUP_ROUNDS)) {
      return { ok: false, error: `Exercise ${i + 1}: rounds must be 1–${MAX_GROUP_ROUNDS}` };
    }
    if (ex.exerciseKey !== null && ex.exerciseKey !== undefined && typeof ex.exerciseKey !== 'string') {
      return { ok: false, error: `Exercise ${i + 1}: invalid exercise key` };
    }
    if (!CATEGORIES.includes(ex.category as typeof CATEGORIES[number])) {
      return { ok: false, error: `Exercise ${i + 1}: invalid category` };
    }
    if (ex.notes !== null && ex.notes !== undefined && (typeof ex.notes !== 'string' || ex.notes.length > 500)) {
      return { ok: false, error: `Exercise ${i + 1}: notes must be 500 characters or fewer` };
    }
    if (!Array.isArray(ex.sets)) {
      return { ok: false, error: `Exercise ${i + 1}: sets must be an array` };
    }
    if (ex.sets.length > MAX_SETS_PER_EXERCISE) {
      return { ok: false, error: `Exercise ${i + 1}: too many sets (max ${MAX_SETS_PER_EXERCISE})` };
    }

    const sets: EntrySet[] = [];
    for (let j = 0; j < ex.sets.length; j++) {
      const result = validateSet(ex.sets[j], j);
      if (!result.ok) {
        return { ok: false, error: `Exercise ${i + 1} (${ex.name}): ${result.error}` };
      }
      sets.push(result.set);
    }

    exercises.push({
      clientId: typeof ex.clientId === 'string' ? ex.clientId : newId(),
      name: ex.name.trim(),
      exerciseKey: (ex.exerciseKey as string | null) ?? null,
      category: ex.category as EntryExercise['category'],
      notes: (ex.notes as string | null) ?? null,
      sets,
      groupId: typeof ex.groupId === 'string' ? ex.groupId : null,
      groupKind: GROUP_KINDS.includes(ex.groupKind as ExerciseGroupKind) ? (ex.groupKind as ExerciseGroupKind) : null,
      groupRounds: typeof ex.groupRounds === 'number' ? Math.floor(ex.groupRounds) : null,
    });
  }

  return { ok: true, exercises: healGroups(exercises) };
}
