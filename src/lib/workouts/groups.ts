// ── Supersets and circuits — the pure rules (workout screen PR 3, Oct 12 2026)
// Tom: "Superset. Two or more exercises grouped and done back to back as one
// set … Circuit. Several exercises done in sequence, repeated for a chosen
// number of rounds … Each exercise in a group still records its own reps and
// weight per round. Users can add or remove exercises in a group, change the
// round count, and turn a group back into separate exercises."
//
// The model (260): a group is the exercises sharing `groupId`, consecutive;
// `groupKind` and `groupRounds` are repeated on every member; a member's SETS
// are its rounds (`setNumber` = the round). Every function here returns a new
// array and keeps every invariant the server heals (entries.ts healGroups),
// so a save never needs healing. The editor calls these; nothing here
// touches the DOM.

import { emptyEntrySet, MAX_GROUP_ROUNDS, type EntryExercise, type EntrySet, type ExerciseGroupKind } from './entries';
import { setHasData, toLbs } from './summary';

export const GROUP_DEFAULT_ROUNDS = 3;
export const GROUP_LABEL: Readonly<Record<ExerciseGroupKind, string>> = { superset: 'Superset', circuit: 'Circuit' };
export const GROUP_HINT: Readonly<Record<ExerciseGroupKind, string>> = {
  superset: 'Two or more exercises back to back, as one set.',
  circuit: 'Exercises in sequence, repeated for rounds.',
};

export interface ExerciseGroup {
  groupId: string;
  kind: ExerciseGroupKind;
  rounds: number;
  /** Index of the first member in the exercises array. */
  start: number;
  members: EntryExercise[];
}

export type RenderItem = { type: 'single'; exercise: EntryExercise; index: number } | { type: 'group'; group: ExerciseGroup };

/** The consecutive runs of members by groupId; a lone member (should not happen after healing) renders single. */
export function groupsOf(exercises: ReadonlyArray<EntryExercise>): ExerciseGroup[] {
  const out: ExerciseGroup[] = [];
  let i = 0;
  while (i < exercises.length) {
    const e = exercises[i];
    if (!e.groupId) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < exercises.length && exercises[j].groupId === e.groupId) j += 1;
    if (j - i >= 2) {
      out.push({ groupId: e.groupId, kind: e.groupKind ?? 'circuit', rounds: e.groupRounds ?? Math.max(1, ...exercises.slice(i, j).map(m => m.sets.length)), start: i, members: exercises.slice(i, j) });
    }
    i = j;
  }
  return out;
}

/** What the editor renders, in order: single cards and group cards. */
export function renderItems(exercises: ReadonlyArray<EntryExercise>): RenderItem[] {
  const groups = groupsOf(exercises);
  const items: RenderItem[] = [];
  let i = 0;
  while (i < exercises.length) {
    const g = groups.find(x => x.start === i);
    if (g) {
      items.push({ type: 'group', group: g });
      i += g.members.length;
    } else {
      items.push({ type: 'single', exercise: exercises[i], index: i });
      i += 1;
    }
  }
  return items;
}

const clampRounds = (n: number) => Math.min(MAX_GROUP_ROUNDS, Math.max(1, Math.floor(n)));

/** Pad a member's sets up to `rounds` with empty sets (never truncate). */
function padTo(e: EntryExercise, rounds: number): EntryExercise {
  if (e.sets.length >= rounds) return e;
  return { ...e, sets: [...e.sets, ...Array.from({ length: rounds - e.sets.length }, (_, k) => emptyEntrySet(e.sets.length + k + 1))] };
}

function stamp(e: EntryExercise, groupId: string, kind: ExerciseGroupKind, rounds: number): EntryExercise {
  return padTo({ ...e, groupId, groupKind: kind, groupRounds: rounds }, rounds);
}

function strip(e: EntryExercise): EntryExercise {
  return { ...e, groupId: null, groupKind: null, groupRounds: null };
}

/**
 * A new group of these exercises (≥ 2), placed where `at` says (the first
 * member's old position when one of them was already in the list, else the
 * end); each member gets `rounds` sets, its existing sets kept. `rounds`
 * grows to the longest member.
 */
export function makeGroup(
  exercises: ReadonlyArray<EntryExercise>,
  kind: ExerciseGroupKind,
  members: ReadonlyArray<EntryExercise>,
  groupId: string,
  rounds: number = GROUP_DEFAULT_ROUNDS,
): EntryExercise[] {
  if (members.length < 2) return [...exercises];
  const ids = new Set(members.map(m => m.clientId));
  const r = clampRounds(Math.max(rounds, ...members.map(m => m.sets.length)));
  const stamped = members.map(m => stamp(m, groupId, kind, r));
  const firstAt = exercises.findIndex(e => ids.has(e.clientId));
  const rest = exercises.filter(e => !ids.has(e.clientId));
  if (firstAt < 0) return [...rest, ...stamped];
  // The group takes the first existing member's place among the others.
  const before = exercises.slice(0, firstAt).filter(e => !ids.has(e.clientId));
  return [...before, ...stamped, ...rest.slice(before.length)];
}

/** Add an exercise to a group (appended after its last member; rounds grow to its sets; every member padded). */
export function addToGroup(exercises: ReadonlyArray<EntryExercise>, groupId: string, exercise: EntryExercise): EntryExercise[] {
  const g = groupsOf(exercises).find(x => x.groupId === groupId);
  if (!g) return [...exercises];
  const r = clampRounds(Math.max(g.rounds, exercise.sets.length));
  const without = exercises.filter(e => e.clientId !== exercise.clientId);
  const start = without.findIndex(e => e.groupId === groupId);
  const members = without.filter(e => e.groupId === groupId).map(m => stamp(m, groupId, g.kind, r));
  const member = stamp(exercise, groupId, g.kind, r);
  const others = without.filter(e => e.groupId !== groupId);
  return [...others.slice(0, start), ...members, member, ...others.slice(start)];
}

/** Take one exercise out of its group (its sets stay; a group left with one member is dissolved). */
export function removeFromGroup(exercises: ReadonlyArray<EntryExercise>, clientId: string): EntryExercise[] {
  const target = exercises.find(e => e.clientId === clientId);
  if (!target?.groupId) return [...exercises];
  const groupId = target.groupId;
  const remaining = exercises.filter(e => e.groupId === groupId && e.clientId !== clientId).length;
  return exercises.map(e => (e.clientId === clientId ? strip(e) : remaining < 2 && e.groupId === groupId ? strip(e) : e));
}

/** Turn a group back into separate exercises — every set stays. */
export function ungroup(exercises: ReadonlyArray<EntryExercise>, groupId: string): EntryExercise[] {
  return exercises.map(e => (e.groupId === groupId ? strip(e) : e));
}

/** Remove a whole group and its exercises. */
export function removeGroup(exercises: ReadonlyArray<EntryExercise>, groupId: string): EntryExercise[] {
  return exercises.filter(e => e.groupId !== groupId);
}

export interface RoundsResult {
  exercises: EntryExercise[];
  /** The rounds actually set — higher than asked when a later round holds data (never truncated). */
  rounds: number;
}

/** Change the round count: new rounds are empty sets on every member; trailing EMPTY rounds beyond the count go; a round with data is kept and the count grows back to it. */
export function setRounds(exercises: ReadonlyArray<EntryExercise>, groupId: string, requested: number): RoundsResult {
  const g = groupsOf(exercises).find(x => x.groupId === groupId);
  if (!g) return { exercises: [...exercises], rounds: 0 };
  let rounds = clampRounds(requested);
  for (const m of g.members) {
    let lastWithData = 0;
    m.sets.forEach((s, i) => {
      if (setHasData(s) || s.completedAt || (s.media ?? []).length > 0) lastWithData = i + 1;
    });
    rounds = Math.max(rounds, lastWithData);
  }
  const next = exercises.map(e => {
    if (e.groupId !== groupId) return e;
    const trimmed = e.sets.length > rounds ? e.sets.slice(0, rounds) : e.sets;
    return padTo({ ...e, groupRounds: rounds, sets: trimmed }, rounds);
  });
  return { exercises: next, rounds };
}

/** One more round on every member, cloning the previous round's reps / weight (never media or completion) — the card's "Add set" rule. */
export function addRound(exercises: ReadonlyArray<EntryExercise>, groupId: string): EntryExercise[] {
  const g = groupsOf(exercises).find(x => x.groupId === groupId);
  if (!g || g.rounds >= MAX_GROUP_ROUNDS) return [...exercises];
  const rounds = g.rounds + 1;
  return exercises.map(e => {
    if (e.groupId !== groupId) return e;
    const previous = e.sets[e.sets.length - 1];
    const clone: EntrySet = previous ? { ...previous, setNumber: e.sets.length + 1, completedAt: null, media: [], restSeconds: null } : emptyEntrySet(1);
    return { ...e, groupRounds: rounds, sets: [...e.sets, clone] };
  });
}

/** Round k (0-based) leaves EVERY member; the rest renumber; the count falls (never below 1). */
export function deleteRound(exercises: ReadonlyArray<EntryExercise>, groupId: string, roundIndex: number): EntryExercise[] {
  const g = groupsOf(exercises).find(x => x.groupId === groupId);
  if (!g || g.rounds <= 1 || roundIndex < 0 || roundIndex >= g.rounds) return [...exercises];
  const rounds = g.rounds - 1;
  return exercises.map(e => {
    if (e.groupId !== groupId) return e;
    const sets = e.sets.filter((_, i) => i !== roundIndex).map((s, i) => ({ ...s, setNumber: i + 1 }));
    return { ...e, groupRounds: rounds, sets };
  });
}

/** Rounds where EVERY member's set has data. */
export function roundsCompleted(g: Pick<ExerciseGroup, 'rounds' | 'members'>): number {
  let n = 0;
  for (let k = 0; k < g.rounds; k++) {
    if (g.members.every(m => m.sets[k] && setHasData(m.sets[k]))) n += 1;
  }
  return n;
}

/** The round in front of the athlete: the first not complete (1-based), else the last. */
export function currentRound(g: Pick<ExerciseGroup, 'rounds' | 'members'>): number {
  for (let k = 0; k < g.rounds; k++) {
    if (!g.members.every(m => m.sets[k] && setHasData(m.sets[k]))) return k + 1;
  }
  return g.rounds;
}

/** "Superset · 3 rounds" — the one spelling the cards and the summary share. */
export function groupLine(kind: ExerciseGroupKind, rounds: number): string {
  return `${GROUP_LABEL[kind]} · ${rounds} ${rounds === 1 ? 'round' : 'rounds'}`;
}

// ── Rounds as a swipe (workout fixes, Oct 13 2026) ──────────────────────────

/** Any member's round k (0-based) holds data — "Copy previous round" is offered only onto an empty round. */
export function roundHasData(members: ReadonlyArray<EntryExercise>, k: number): boolean {
  return members.some(m => m.sets[k] && setHasData(m.sets[k]));
}

/**
 * Round k (0-based, ≥ 1) takes round k−1's VALUES on every member — reps,
 * weight and unit, duration, distance and unit — never media, completion or
 * rest: those belong to the round that did them. The same array comes back
 * for round 0, an unknown group or a member without the previous round.
 */
export function copyRound(exercises: ReadonlyArray<EntryExercise>, groupId: string, k: number): EntryExercise[] {
  const g = groupsOf(exercises).find(x => x.groupId === groupId);
  if (!g || k < 1 || k >= g.rounds) return [...exercises];
  return exercises.map(e => {
    if (e.groupId !== groupId) return e;
    const previous = e.sets[k - 1];
    const target = e.sets[k];
    if (!previous || !target) return e;
    const sets = e.sets.map((s, i) =>
      i === k
        ? { ...s, reps: previous.reps, weight: previous.weight, weightUnit: previous.weightUnit, durationSeconds: previous.durationSeconds, distance: previous.distance, distanceUnit: previous.distanceUnit }
        : s,
    );
    return { ...e, sets };
  });
}

/** Σ reps × weight (lbs) over a group's members — the post card's "· 1,200 lbs" line. */
export function groupVolumeLbs(members: ReadonlyArray<EntryExercise>): number {
  let volume = 0;
  for (const m of members) {
    for (const s of m.sets) {
      if (s.weight !== null && s.weight > 0 && s.reps !== null && s.reps > 0) volume += s.reps * toLbs(s.weight, s.weightUnit);
    }
  }
  return Math.round(volume);
}
