// ── Training's Exercises view: one row per exercise, one page per exercise ───
// Training redesign PR 5 (Nov 11 2026). Pure. The best apps keep an exercise's
// records, chart and history on the exercise's own page (Strong, Hevy,
// Boostcamp); here they were a five-column table, a chart behind a chip
// picker and a trophy wall, each naming the lift its own way. This file is
// what a list row and a detail page are made of — every number still derived
// from the sets (prs.ts), nothing stored.

import { BODY_AREAS, EXERCISE_MAP, type BodyArea } from '@/lib/workout-config';
import { formatSetLine } from './summary';
import { beats, bestsOf, exerciseIdOf, foldBests, PR_KIND_RANK, type ExerciseBests, type PrKind } from './prs';
import type { EntryExercise } from './entries';

/** One completed session, as the readers hand it over (oldest or newest first — the functions sort). */
export interface ExerciseSession {
  id: string;
  startedAt: string;
  title: string;
  exercises: EntryExercise[];
  /** PR 6: a tested max (tested-max.ts) — a best the athlete typed in. It counts in the bests and raises the bar; it is not a workout and is never a record. */
  tested?: boolean;
}

export interface ExerciseSummary {
  ref: string;
  name: string;
  area: BodyArea;
  bests: ExerciseBests;
  /** The ONE number the list shows: the strongest kind this exercise has (heaviest → reps → hold → …). */
  headline: { kind: PrKind; value: number } | null;
  /** When it was last trained, and in how many sessions. */
  lastAt: string;
  sessions: number;
}

/** The catalog's label and area for an identity; a name the catalog does not know keeps its own and is "Other". */
export function describeExercise(ref: string, fallbackName: string): { name: string; area: BodyArea } {
  const def = EXERCISE_MAP[ref];
  return def ? { name: def.label, area: def.bodyArea } : { name: fallbackName, area: 'other' };
}

/** What a row leads with: a weight if it has one, else reps, else a hold; the estimate and the volume are the page's. */
const HEADLINE_RANK: readonly PrKind[] = ['heaviest', 'reps', 'duration', 'e1rm', 'volume'];
export function headlineOf(b: ExerciseBests): { kind: PrKind; value: number } | null {
  for (const kind of HEADLINE_RANK) {
    const v = b[kind];
    if (v !== null && v !== undefined) return { kind, value: v };
  }
  return null;
}

/** Every exercise the sessions hold, with its all-time bests — most recently trained first. An exercise with no number at all (an empty card) is not listed. */
export function summarizeExercises(sessions: readonly ExerciseSession[]): ExerciseSummary[] {
  const perSession = sessions.map(s => ({ s, bests: bestsOf(s.exercises) }));
  const all = foldBests(perSession.map(p => p.bests));
  const seen = new Map<string, { lastAt: string; sessions: number; name: string }>();
  for (const { s, bests } of perSession) {
    for (const [ref, b] of bests) {
      const prev = seen.get(ref);
      const later = !prev || Date.parse(s.startedAt) > Date.parse(prev.lastAt);
      // "N sessions" counts workouts; a tested max is a number typed in, not a session.
      seen.set(ref, { lastAt: later ? s.startedAt : prev!.lastAt, sessions: (prev?.sessions ?? 0) + (s.tested ? 0 : 1), name: later ? b.name : prev!.name });
    }
  }
  const out: ExerciseSummary[] = [];
  for (const [ref, bests] of all) {
    const headline = headlineOf(bests);
    const meta = seen.get(ref);
    if (!headline || !meta) continue;
    out.push({ ref, ...describeExercise(ref, meta.name), bests, headline, lastAt: meta.lastAt, sessions: meta.sessions });
  }
  return out.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));
}

/** The list, cut into body areas in the catalog's order; an area with nothing is not shown. Inside an area: most recently trained first. */
export function groupByArea(list: readonly ExerciseSummary[]): Array<{ area: BodyArea; label: string; items: ExerciseSummary[] }> {
  return BODY_AREAS.map(a => ({ area: a.id, label: a.label, items: list.filter(e => e.area === a.id) })).filter(g => g.items.length > 0);
}

export interface ExerciseTimelinePoint {
  sessionId: string;
  startedAt: string;
  title: string;
  /** This session's own bests for the exercise. */
  bests: ExerciseBests;
  /** "5 reps × 185 lbs" — every set with a number, in order. */
  sets: string[];
  /** The kinds this session set a record in — against every EARLIER session; the first session is the baseline and has none. */
  records: PrKind[];
  /** A tested max: no sets were logged, nothing opens, never a record. */
  tested?: boolean;
}

/**
 * One exercise, session by session, NEWEST first. A record is a kind whose
 * value beat the best of every earlier session by prs.ts's margin; a kind
 * seen for the first time is a baseline. The same rule the finish summary
 * uses, replayed over the whole history — so the page and the summary can
 * never disagree about what was a record.
 */
export function exerciseTimeline(sessions: readonly ExerciseSession[], ref: string): ExerciseTimelinePoint[] {
  const ordered = [...sessions].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const running: Record<PrKind, number | null> = { heaviest: null, e1rm: null, reps: null, volume: null, duration: null };
  const out: ExerciseTimelinePoint[] = [];
  for (const s of ordered) {
    const mine = s.exercises.filter(e => exerciseIdOf(e) === ref);
    if (mine.length === 0) continue;
    const bests = bestsOf(mine).get(ref);
    if (!bests || headlineOf(bests) === null) continue;
    const first = out.length === 0;
    const records: PrKind[] = [];
    for (const kind of PR_KIND_RANK) {
      const v = bests[kind];
      if (v === null || v === undefined) continue;
      const p = running[kind];
      if (!first && !s.tested && p !== null && beats(kind, v, p)) records.push(kind);
      running[kind] = p === null ? v : Math.max(p, v);
    }
    out.push({ sessionId: s.id, startedAt: s.startedAt, title: s.title, bests, sets: mine.flatMap(e => e.sets.map(formatSetLine)).filter(line => line.length > 0), records, ...(s.tested ? { tested: true } : {}) });
  }
  return out.reverse();
}

/** What the page charts: the weight if any session lifted one, else reps, else the hold. */
export function chartKindOf(timeline: readonly ExerciseTimelinePoint[]): PrKind | null {
  for (const kind of ['heaviest', 'reps', 'duration'] as const) {
    if (timeline.some(p => (p.bests[kind] ?? null) !== null)) return kind;
  }
  return null;
}
