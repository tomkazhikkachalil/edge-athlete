// ── The round timer (activities details A3, Oct 16 2026) — pure, ZERO imports ─
// HIIT, boxing, EMOM: a bell at every work / rest boundary while the phone
// sits on the floor. Five formats, each one SCHEDULE of phases in seconds
// from the timer's start (Tom's review: Tabata, EMOM, AMRAP and custom
// intervals, not only rounds with rest).
//
// Time is never counted by ticks. The timer stores the RECORDING second it
// started at; the phase is always read from the recording's own clock
// (elapsedS — wall-clock timestamps, pauses excluded). A locked screen or a
// throttled tab therefore never skews the schedule, a pause pauses the timer,
// and on return the screen is exactly where it should be (boundaryCrossed
// says a bell was missed). At Finish the schedule becomes segments: each
// work phase a 'round', each rest a 'recovery' — the activity page's
// segments table and the "N rounds" tile read them.

export const TIMER_FORMATS = ['rounds', 'tabata', 'emom', 'amrap', 'intervals'] as const;
export type TimerFormat = (typeof TIMER_FORMATS)[number];

export const TIMER_FORMAT_LABELS: Readonly<Record<TimerFormat, string>> = {
  rounds: 'Rounds',
  tabata: 'Tabata',
  emom: 'EMOM',
  amrap: 'AMRAP',
  intervals: 'Intervals',
};

export const TIMER_FORMAT_HINTS: Readonly<Record<TimerFormat, string>> = {
  rounds: 'Work and rest, round after round — boxing, MMA, pads.',
  tabata: '8 rounds of 20 s on, 10 s off.',
  emom: 'Every minute on the minute — a bell each minute.',
  amrap: 'As many rounds as possible before the clock runs out.',
  intervals: 'Your own work and rest, with an optional warm-up and cool-down.',
};

export interface TimerSpec {
  format: TimerFormat;
  /** Rounds (EMOM: minutes; AMRAP: 1). */
  rounds: number;
  /** A round's work (EMOM: the work window inside each minute; AMRAP: the whole cap). */
  workS: number;
  /** The rest after each round but the last (EMOM: the rest of the minute; AMRAP: 0). */
  restS: number;
  warmupS: number;
  cooldownS: number;
}

export type PhaseKind = 'warmup' | 'work' | 'rest' | 'cooldown';

export interface Phase {
  kind: PhaseKind;
  /** 1-based round the phase belongs to (warm-up 0, cool-down rounds + 1). */
  round: number;
  fromS: number;
  toS: number;
}

export const TIMER_LIMITS = {
  rounds: { min: 1, max: 60 },
  workS: { min: 5, max: 3600 },
  restS: { min: 0, max: 1800 },
  warmupS: { min: 0, max: 1800 },
  cooldownS: { min: 0, max: 1800 },
} as const;

/** The presets a format opens with. */
export const TIMER_PRESETS: Readonly<Record<TimerFormat, readonly { label: string; spec: TimerSpec }[]>> = {
  rounds: [
    { label: '3 × 3:00 / 1:00', spec: { format: 'rounds', rounds: 3, workS: 180, restS: 60, warmupS: 0, cooldownS: 0 } },
    { label: '5 × 5:00 / 1:00', spec: { format: 'rounds', rounds: 5, workS: 300, restS: 60, warmupS: 0, cooldownS: 0 } },
    { label: '12 × 3:00 / 1:00', spec: { format: 'rounds', rounds: 12, workS: 180, restS: 60, warmupS: 0, cooldownS: 0 } },
  ],
  tabata: [{ label: '8 × 0:20 / 0:10', spec: { format: 'tabata', rounds: 8, workS: 20, restS: 10, warmupS: 0, cooldownS: 0 } }],
  emom: [
    { label: '10 min', spec: { format: 'emom', rounds: 10, workS: 60, restS: 0, warmupS: 0, cooldownS: 0 } },
    { label: '20 min · 0:40 on', spec: { format: 'emom', rounds: 20, workS: 40, restS: 20, warmupS: 0, cooldownS: 0 } },
  ],
  amrap: [
    { label: '12 min', spec: { format: 'amrap', rounds: 1, workS: 720, restS: 0, warmupS: 0, cooldownS: 0 } },
    { label: '20 min', spec: { format: 'amrap', rounds: 1, workS: 1200, restS: 0, warmupS: 0, cooldownS: 0 } },
  ],
  intervals: [{ label: '6 × 1:00 / 1:00', spec: { format: 'intervals', rounds: 6, workS: 60, restS: 60, warmupS: 300, cooldownS: 300 } }],
};

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : dflt;
  return Math.min(hi, Math.max(lo, n));
};

/**
 * A spec the format's own rules hold: Tabata is fixed; an EMOM minute is 60 s
 * (work window + rest); an AMRAP is one round with no rest; only Intervals
 * keeps a warm-up and a cool-down. Unknown input (a stored v-old spec) is
 * clamped, never thrown.
 */
export function normalizeSpec(raw: Partial<TimerSpec> & { format: TimerFormat }): TimerSpec {
  const f = (TIMER_FORMATS as readonly string[]).includes(raw.format) ? raw.format : 'rounds';
  if (f === 'tabata') return { format: 'tabata', rounds: 8, workS: 20, restS: 10, warmupS: 0, cooldownS: 0 };
  if (f === 'emom') {
    const work = clampInt(raw.workS, 5, 60, 60);
    return { format: 'emom', rounds: clampInt(raw.rounds, 1, TIMER_LIMITS.rounds.max, 10), workS: work, restS: 60 - work, warmupS: 0, cooldownS: 0 };
  }
  if (f === 'amrap') return { format: 'amrap', rounds: 1, workS: clampInt(raw.workS, 60, TIMER_LIMITS.workS.max, 720), restS: 0, warmupS: 0, cooldownS: 0 };
  return {
    format: f,
    rounds: clampInt(raw.rounds, TIMER_LIMITS.rounds.min, TIMER_LIMITS.rounds.max, 3),
    workS: clampInt(raw.workS, TIMER_LIMITS.workS.min, TIMER_LIMITS.workS.max, 180),
    restS: clampInt(raw.restS, TIMER_LIMITS.restS.min, TIMER_LIMITS.restS.max, 60),
    warmupS: f === 'intervals' ? clampInt(raw.warmupS, 0, TIMER_LIMITS.warmupS.max, 0) : 0,
    cooldownS: f === 'intervals' ? clampInt(raw.cooldownS, 0, TIMER_LIMITS.cooldownS.max, 0) : 0,
  };
}

/** Every phase in order. A rest of 0 s, and the rest after the last round, are left out. */
export function schedule(spec: TimerSpec): Phase[] {
  const out: Phase[] = [];
  let t = 0;
  if (spec.warmupS > 0) {
    out.push({ kind: 'warmup', round: 0, fromS: 0, toS: spec.warmupS });
    t = spec.warmupS;
  }
  for (let r = 1; r <= spec.rounds; r++) {
    out.push({ kind: 'work', round: r, fromS: t, toS: t + spec.workS });
    t += spec.workS;
    // An EMOM's last minute still runs its full 60 s; elsewhere the last rest is dropped.
    const lastRest = r === spec.rounds && spec.format !== 'emom';
    if (spec.restS > 0 && !lastRest) {
      out.push({ kind: 'rest', round: r, fromS: t, toS: t + spec.restS });
      t += spec.restS;
    }
  }
  if (spec.cooldownS > 0) out.push({ kind: 'cooldown', round: spec.rounds + 1, fromS: t, toS: t + spec.cooldownS });
  return out;
}

export function totalS(spec: TimerSpec): number {
  const s = schedule(spec);
  return s.length ? s[s.length - 1].toS : 0;
}

export interface PhaseNow {
  /** Index into the schedule; schedule.length once done. */
  index: number;
  phase: Phase | null;
  /** Seconds left in this phase (0 once done). */
  remainingS: number;
  done: boolean;
}

/** Where the timer is `t` seconds after it started. */
export function phaseAt(sched: readonly Phase[], t: number): PhaseNow {
  const at = Math.max(0, t);
  for (let i = 0; i < sched.length; i++) {
    if (at < sched[i].toS) return { index: i, phase: sched[i], remainingS: Math.ceil(sched[i].toS - at), done: false };
  }
  return { index: sched.length, phase: null, remainingS: 0, done: true };
}

/**
 * How many boundaries (a phase starting, or the end) lie in (prevT, t] —
 * 0 means no bell. More than 1 means the page was away (a lock, a throttled
 * tab) and bells were missed: the screen rings once on return.
 */
export function boundaryCrossed(sched: readonly Phase[], prevT: number, t: number): number {
  if (!(t > prevT)) return 0;
  let n = 0;
  for (let i = 0; i < sched.length; i++) {
    const start = sched[i].fromS;
    if (start > 0 && start > prevT && start <= t) n++;
  }
  const end = sched.length ? sched[sched.length - 1].toS : 0;
  if (end > 0 && end > prevT && end <= t) n++;
  return n;
}

/** The DB's segment cap (251), mirrored so this file needs no import. */
const SEGMENT_CAP = 50;
const MIN_SEGMENT_S = 5;

export interface TimerSegment {
  id: string;
  kind: 'round' | 'recovery';
  from_s: number;
  to_s: number;
  label?: string;
}

/**
 * The segments a timer leaves behind. `startS` / `endS` are seconds into
 * the RECORDING (the timer's start, and where it stopped or the recording
 * finished). Work → 'round' ("Round 3"), rest → 'recovery'; phases clipped
 * to endS; warm-up and cool-down are not rounds. An AMRAP's rounds are the
 * athlete's own "+1 round" taps (`amrapTapsS`, seconds into the recording).
 * Past the cap, rests go first, then the latest rounds.
 */
export function timerSegments(spec: TimerSpec, startS: number, endS: number, amrapTapsS: readonly number[] = []): TimerSegment[] {
  const out: TimerSegment[] = [];
  if (spec.format === 'amrap') {
    let from = startS;
    amrapTapsS
      .filter(t => t > startS && t <= endS)
      .forEach((t, i) => {
        if (t - from >= MIN_SEGMENT_S) out.push({ id: `round-${startS}-${i + 1}`, kind: 'round', from_s: Math.round(from), to_s: Math.round(t), label: `Round ${i + 1}` });
        from = t;
      });
    return out.slice(0, SEGMENT_CAP);
  }
  for (const p of schedule(spec)) {
    if (p.kind !== 'work' && p.kind !== 'rest') continue;
    const from = startS + p.fromS;
    const to = Math.min(startS + p.toS, endS);
    if (to - from < MIN_SEGMENT_S) continue;
    out.push(
      p.kind === 'work'
        ? { id: `round-${startS}-${p.round}`, kind: 'round', from_s: from, to_s: to, label: `Round ${p.round}` }
        : { id: `rest-${startS}-${p.round}`, kind: 'recovery', from_s: from, to_s: to }
    );
  }
  if (out.length <= SEGMENT_CAP) return out;
  const rounds = out.filter(s => s.kind === 'round');
  return rounds.slice(0, SEGMENT_CAP);
}

/** "Tabata · Round 3 of 8" / "AMRAP · 4 rounds" / "Warm-up" — the live line. */
export function phaseLine(spec: TimerSpec, now: PhaseNow, amrapCount = 0): string {
  const name = TIMER_FORMAT_LABELS[spec.format];
  if (now.done) return spec.format === 'amrap' ? `${name} · ${amrapCount} round${amrapCount === 1 ? '' : 's'} · done` : `${name} · done`;
  const p = now.phase!;
  if (p.kind === 'warmup') return `${name} · Warm-up`;
  if (p.kind === 'cooldown') return `${name} · Cool-down`;
  if (spec.format === 'amrap') return `${name} · ${amrapCount} round${amrapCount === 1 ? '' : 's'}`;
  const unit = spec.format === 'emom' ? 'Minute' : 'Round';
  return `${name} · ${unit} ${p.round} of ${spec.rounds}`;
}

/** "Work" / "Rest" / … for the phase's chip. */
export const PHASE_LABELS: Readonly<Record<PhaseKind, string>> = { warmup: 'Warm-up', work: 'Work', rest: 'Rest', cooldown: 'Cool-down' };

/** m:ss */
export function clock(s: number): string {
  const v = Math.max(0, Math.round(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
}
