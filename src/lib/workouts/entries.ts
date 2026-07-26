/**
 * Workout entries payload — the exercises+sets snapshot exchanged between
 * the editor and the API (PUT /api/workouts/[id]/entries and manual POST).
 * Validation mirrors the DB CHECK constraints so Postgres errors are never
 * the first line of defense.
 */

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
}

export interface EntryExercise {
  name: string;
  exerciseKey: string | null; // catalog key; null = custom
  category: 'strength' | 'cardio' | 'mobility' | 'other';
  notes: string | null;
  sets: EntrySet[];
}

export const MAX_EXERCISES = 40;
export const MAX_SETS_PER_EXERCISE = 50;
export const MAX_MEDIA_PER_SET = 4;

const MEDIA_TYPES = ['image', 'video'] as const;

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
    if (
      typeof m.url !== 'string' ||
      m.url.length === 0 ||
      m.url.length > 2048 ||
      !(m.url.startsWith('https://') || m.url.startsWith('/'))
    ) {
      return { ok: false, error: 'invalid media URL' };
    }
    if (!MEDIA_TYPES.includes(m.type as typeof MEDIA_TYPES[number])) {
      return { ok: false, error: 'invalid media type' };
    }
    media.push({ url: m.url, type: m.type as SetMedia['type'] });
  }
  return { ok: true, media };
}

const CATEGORIES = ['strength', 'cardio', 'mobility', 'other'] as const;
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
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    if (typeof e !== 'object' || e === null) {
      return { ok: false, error: `Exercise ${i + 1} is malformed` };
    }
    const ex = e as Record<string, unknown>;
    if (typeof ex.name !== 'string' || ex.name.trim().length === 0 || ex.name.trim().length > 80) {
      return { ok: false, error: `Exercise ${i + 1}: name must be 1–80 characters` };
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
      name: ex.name.trim(),
      exerciseKey: (ex.exerciseKey as string | null) ?? null,
      category: ex.category as EntryExercise['category'],
      notes: (ex.notes as string | null) ?? null,
      sets,
    });
  }

  return { ok: true, exercises };
}
