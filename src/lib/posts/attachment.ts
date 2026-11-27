// ── A post's attached activity and its stat plate (General post spec, Nov 26 2026) ──
// Pure, zero imports. A post may attach ONE of its author's logged
// activities: a finished golf round, a finished workout, a tracked activity
// (a run, a ride, …) or a game's stat line. The post then carries a STAT
// PLATE: the activity's headline number, its sport, its name and one line of
// detail; a golf round also carries a strip of blocks, one per hole.
//
// The plate is READ, never stored: the post holds only a reference
// (posts.attached_*_id, migration 321) and the server builds the plate from
// the source row on every read — an edit shows through, and a source that is
// later hidden or deleted takes its plate away (the post stays).
//
// Tom's rule for what may be attached (Nov 26 2026): everything finished,
// except what he hid from his profile and what is marked Only me. A workout
// that was never shared may be attached; only this summary shows.

export type AttachKind = 'round' | 'workout' | 'activity' | 'stat_line';
export const ATTACH_KINDS: readonly AttachKind[] = ['round', 'workout', 'activity', 'stat_line'];

export interface AttachRef {
  kind: AttachKind;
  id: string;
}

/** The posts column that holds each kind's reference (321). */
export const ATTACH_COLUMN: Readonly<Record<AttachKind, string>> = {
  round: 'attached_round_id',
  workout: 'attached_workout_id',
  activity: 'attached_activity_id',
  stat_line: 'attached_post_id',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A request's `attached` value, checked: null when absent, 'invalid' when malformed. */
export function parseAttachRef(value: unknown): AttachRef | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') return 'invalid';
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  if (typeof kind !== 'string' || !(ATTACH_KINDS as readonly string[]).includes(kind)) return 'invalid';
  if (typeof id !== 'string' || !UUID.test(id)) return 'invalid';
  return { kind: kind as AttachKind, id };
}

/** The reference a post row holds, if any (the first set column, in kind order). */
export function attachRefOf(row: Record<string, unknown>): AttachRef | null {
  for (const kind of ATTACH_KINDS) {
    const id = row[ATTACH_COLUMN[kind]];
    if (typeof id === 'string' && id !== '') return { kind, id };
  }
  return null;
}

export const attachKey = (ref: AttachRef): string => `${ref.kind}:${ref.id}`;

/** The plate's colour family. `sport` carries its own colour (the sport's). */
export type PlateTone = 'golf' | 'strength' | 'run' | 'sport';
/** A hole's block: the live round's score scale; `none` = not recorded. */
export type HoleTone = 'great' | 'good' | 'text' | 'warn' | 'bad' | 'none';

export interface PlateReading {
  headline: string;
  unit: string | null;
  detail: string | null;
}

export interface StatPlateData extends PlateReading {
  kind: AttachKind;
  id: string;
  /** The micro label: "Golf", "Strength", "Run", "Ice Hockey". */
  sport: string;
  /** The activity's own name: the course, the top lift, the run's name. */
  name: string;
  tone: PlateTone;
  /** A hex for `tone: 'sport'` (the sport's own colour); null otherwise. */
  colour: string | null;
  /** Golf only: one tone per hole, in order. */
  holes?: HoleTone[];
  /** When it happened (ISO date or timestamp), for the picker's order. */
  at: string | null;
  /** The same reading in miles, when the metric one is a distance (a viewer who chose miles). */
  imperial?: PlateReading;
}

// ── What may be attached ─────────────────────────────────────────────────────

export function roundAttachable(r: { is_complete: boolean | null; gross_score: number | null; profile_hidden_at: string | null }): boolean {
  return r.is_complete === true && typeof r.gross_score === 'number' && r.gross_score > 0 && !r.profile_hidden_at;
}
export function workoutAttachable(w: { status: string | null; profile_hidden_at: string | null }): boolean {
  return w.status === 'completed' && !w.profile_hidden_at;
}
export function activityAttachable(a: { only_me: boolean | null }): boolean {
  return a.only_me !== true;
}
export function statLineAttachable(p: { status: string | null; stats_type: string | null }): boolean {
  return p.status === 'published' && p.stats_type === 'stat_line';
}

// ── Numbers as words ─────────────────────────────────────────────────────────

/** 140 → "140", 62.5 → "62.5", 62.50 → "62.5" (two decimals at most). */
export function trimNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return String(Math.round(value * 100) / 100);
}

/** 3723 → "1:02:03", 725 → "12:05". */
export function clockOf(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h}:${String(m).padStart(2, '0')}` : String(m)}:${String(s).padStart(2, '0')}`;
}

/** Strokes against par: "+6", "E", "-2". */
export function toParWords(strokes: number, par: number): string {
  const diff = strokes - par;
  return diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff);
}

/** One hole's block (the live round's scale: eagle or better, birdie and par,
 *  bogey, double, triple or worse). */
export function holeTone(strokes: number | null | undefined, par: number | null | undefined): HoleTone {
  if (typeof strokes !== 'number' || typeof par !== 'number' || strokes <= 0 || par <= 0) return 'none';
  const diff = strokes - par;
  if (diff <= -2) return 'great';
  if (diff <= 0) return 'good';
  if (diff === 1) return 'text';
  if (diff === 2) return 'warn';
  return 'bad';
}

// ── The plates ───────────────────────────────────────────────────────────────

export interface RoundSource {
  id: string;
  date: string | null;
  course: string;
  holes: number | null;
  par: number | null;
  gross_score: number;
}
export interface HoleSource {
  hole_number: number;
  par: number | null;
  strokes: number | null;
}

/** A golf round: the total score; "+6 · 18 holes"; a block per hole when the
 *  card was kept hole by hole (a quick-entry round has no strip). */
export function roundPlate(round: RoundSource, holes: readonly HoleSource[] = []): StatPlateData {
  const count = round.holes === 9 ? 9 : 18;
  const scored = holes.filter(h => typeof h.strokes === 'number' && h.strokes > 0);
  // To par from the card when every scored hole has its par; else from the
  // round's own par, which is only trusted for a full eighteen.
  let toPar: string | null = null;
  if (scored.length > 0 && scored.every(h => typeof h.par === 'number' && h.par > 0)) {
    toPar = toParWords(scored.reduce((n, h) => n + (h.strokes as number), 0), scored.reduce((n, h) => n + (h.par as number), 0));
  } else if (count === 18 && typeof round.par === 'number' && round.par > 0) {
    toPar = toParWords(round.gross_score, round.par);
  }
  const strip: HoleTone[] | undefined =
    scored.length > 0
      ? Array.from({ length: count }, (_, i) => {
          const hole = holes.find(h => h.hole_number === i + 1);
          return holeTone(hole?.strokes, hole?.par);
        })
      : undefined;
  return {
    kind: 'round',
    id: round.id,
    sport: 'Golf',
    name: round.course.trim() || 'Golf round',
    headline: String(round.gross_score),
    unit: null,
    detail: [toPar, `${count} holes`].filter(Boolean).join(' · '),
    tone: 'golf',
    colour: null,
    ...(strip ? { holes: strip } : {}),
    at: round.date,
  };
}

export interface WorkoutSource {
  id: string;
  title: string | null;
  started_at: string | null;
  duration_seconds: number | null;
}
export interface SetSource {
  exercise: string;
  weight: number | null;
  weight_unit: string | null;
  reps: number | null;
}

const KG_IN_LB = 2.2046226218;
const inLb = (set: SetSource): number => (set.weight ?? 0) * (set.weight_unit === 'kg' ? KG_IN_LB : 1);

/** A workout: the heaviest set's weight in the unit it was logged in, its
 *  exercise as the name; "5 reps · 12 sets". A workout without weights reads
 *  its sets. */
export function workoutPlate(workout: WorkoutSource, sets: readonly SetSource[]): StatPlateData {
  const base = { kind: 'workout' as const, id: workout.id, sport: 'Strength', tone: 'strength' as const, colour: null, at: workout.started_at };
  const total = sets.length;
  const setsWords = `${total} ${total === 1 ? 'set' : 'sets'}`;
  const top = sets.filter(s => typeof s.weight === 'number' && s.weight > 0).reduce<SetSource | null>((best, s) => (best === null || inLb(s) > inLb(best) ? s : best), null);
  if (top) {
    return {
      ...base,
      name: top.exercise.trim() || workout.title?.trim() || 'Workout',
      headline: trimNumber(top.weight as number),
      unit: top.weight_unit === 'kg' ? 'kg' : 'lb',
      detail: [typeof top.reps === 'number' && top.reps > 0 ? `${top.reps} ${top.reps === 1 ? 'rep' : 'reps'}` : null, setsWords].filter(Boolean).join(' · '),
    };
  }
  const duration = typeof workout.duration_seconds === 'number' && workout.duration_seconds > 0 ? clockOf(workout.duration_seconds) : null;
  return {
    ...base,
    name: workout.title?.trim() || 'Workout',
    headline: total > 0 ? String(total) : duration ?? '—',
    unit: total > 0 ? (total === 1 ? 'set' : 'sets') : null,
    detail: total > 0 ? duration : null,
  };
}

export interface ActivitySource {
  id: string;
  name: string;
  /** The type's display word: "Run", "Ride", "Swim". */
  label: string;
  started_at: string | null;
  distance_m: number | null;
  moving_s: number | null;
  elapsed_s: number | null;
  /** How the type reads its speed. */
  paceStyle: 'pace' | 'speed' | 'swim_pace' | 'pace_500m';
}

const METRES = { km: 1000, mi: 1609.344 } as const;

function activityReading(a: ActivitySource, unit: 'km' | 'mi'): PlateReading {
  const seconds = a.moving_s && a.moving_s > 0 ? a.moving_s : a.elapsed_s && a.elapsed_s > 0 ? a.elapsed_s : null;
  const clock = seconds ? clockOf(seconds) : null;
  if (!a.distance_m || a.distance_m <= 0) return { headline: clock ?? '—', unit: null, detail: null };
  const distance = a.distance_m / METRES[unit];
  let speed: string | null = null;
  if (seconds) {
    if (a.paceStyle === 'speed') speed = `${((a.distance_m / seconds) * 3600 / METRES[unit]).toFixed(1)} ${unit === 'km' ? 'km/h' : 'mph'}`;
    else if (a.paceStyle === 'swim_pace') speed = `${clockOf((seconds / a.distance_m) * 100)} /100m`;
    else if (a.paceStyle === 'pace_500m') speed = `${clockOf((seconds / a.distance_m) * 500)} /500m`;
    else speed = `${clockOf((seconds / a.distance_m) * METRES[unit])} /${unit}`;
  }
  return {
    headline: distance >= 100 ? distance.toFixed(0) : trimNumber(Math.round(distance * 10) / 10),
    unit,
    detail: [clock, speed].filter(Boolean).join(' · ') || null,
  };
}

/** A tracked activity: the distance; "48:12 · 4:44 /km". Without a distance, its time. */
export function activityPlate(a: ActivitySource): StatPlateData {
  const metric = activityReading(a, 'km');
  return {
    kind: 'activity',
    id: a.id,
    sport: a.label,
    name: a.name.trim() || a.label,
    ...metric,
    tone: 'run',
    colour: null,
    at: a.started_at,
    ...(metric.unit === 'km' ? { imperial: activityReading(a, 'mi') } : {}),
  };
}

export interface StatLineSource {
  /** The stat line's post id. */
  id: string;
  sport: string;
  colour: string | null;
  date: string | null;
  opponent: string | null;
  /** The schema's hero stat: its label and value (null when nothing to headline). */
  heroLabel: string;
  heroValue: number | null;
  /** The schema's joined line ("2 G • 1 A"), when it has one. */
  line: string | null;
}

/** A game's stat line: the sport's hero number. Null when the line has
 *  nothing to headline (it is then not offered). */
export function statLinePlate(s: StatLineSource): StatPlateData | null {
  if (s.heroValue === null || !Number.isFinite(s.heroValue)) return null;
  return {
    kind: 'stat_line',
    id: s.id,
    sport: s.sport,
    name: s.opponent?.trim() ? `${s.sport} · ${s.opponent.trim()}` : s.sport,
    headline: trimNumber(s.heroValue),
    unit: s.heroLabel.toLowerCase(),
    detail: s.line,
    tone: 'sport',
    colour: s.colour,
    at: s.date,
  };
}

/** The picker's list: newest first, the undated last. */
export function sortAttachable(plates: readonly StatPlateData[]): StatPlateData[] {
  const time = (p: StatPlateData) => (p.at ? Date.parse(p.at) || 0 : 0);
  return [...plates].sort((a, b) => time(b) - time(a));
}

/** The composer row's label: "Golf · Loch March"; a name that repeats the sport stands alone. */
export function attachRowLabel(p: Pick<StatPlateData, 'sport' | 'name'>): string {
  return p.name === p.sport || p.name.startsWith(`${p.sport} · `) ? p.name : `${p.sport} · ${p.name}`;
}

/** The reading for a viewer's distance unit. */
export function readingFor(p: StatPlateData, unit: 'km' | 'mi'): PlateReading {
  return unit === 'mi' && p.imperial ? p.imperial : { headline: p.headline, unit: p.unit, detail: p.detail };
}
