// ── A combat bout's result (Oct 16 2026, combat sports C1) — pure, ZERO imports ─
// Tom (Oct 15): MMA, boxing, wrestling and jiu-jitsu are SPORTS with real
// results — a bout carries the opponent, W / L / D / NC, HOW it ended (KO,
// TKO, submission, decision, pin …), the round and the time, and its context
// (weight class, rounds scheduled, wrestling style, gi or no-gi and belt,
// amateur or pro).
//
// The bout rides on the stat line as `bout` beside the numeric `stats`. The
// envelope's own `result` stays W / L / T for every existing reader (the
// first-win badge, the share card, the cards): a draw is T, a no contest
// carries no result at all — it is never a win. `envelopeResult` is the one
// mapping. A self-posted bout's opponent is free text, so it is NOT a shared
// game: athlete_performances.outcome stays NULL for it (244's rule — an
// outcome needs a context_key), and no DDL is needed until bouts become
// events of their own.

export const COMBAT_SPORT_KEYS = ['mma', 'boxing', 'wrestling', 'bjj'] as const;
export type CombatSportKey = (typeof COMBAT_SPORT_KEYS)[number];

export function isCombatSport(v: unknown): v is CombatSportKey {
  return typeof v === 'string' && (COMBAT_SPORT_KEYS as readonly string[]).includes(v);
}

export const BOUT_RESULTS = ['W', 'L', 'D', 'NC'] as const;
export type BoutResult = (typeof BOUT_RESULTS)[number];

export const BOUT_RESULT_LABELS: Readonly<Record<BoutResult, string>> = { W: 'Win', L: 'Loss', D: 'Draw', NC: 'No contest' };

export interface MethodDef {
  value: string;
  label: string;
  /** Ends the bout early — counts as a finish on the profile. */
  finish?: boolean;
  /** The bout went its distance: no round / time is asked. */
  distance?: boolean;
}

const m = (value: string, label: string, flags: Omit<MethodDef, 'value' | 'label'> = {}): MethodDef => ({ value, label, ...flags });

/** How a bout can end, per sport — the composer offers these, the validator holds them. */
export const BOUT_METHODS_BY_SPORT: Readonly<Record<CombatSportKey, readonly MethodDef[]>> = {
  mma: [
    m('ko', 'KO', { finish: true }),
    m('tko', 'TKO', { finish: true }),
    m('submission', 'Submission', { finish: true }),
    m('decision_unanimous', 'Unanimous decision', { distance: true }),
    m('decision_split', 'Split decision', { distance: true }),
    m('decision_majority', 'Majority decision', { distance: true }),
    m('doctor_stoppage', 'Doctor stoppage', { finish: true }),
    m('dq', 'Disqualification'),
  ],
  boxing: [
    m('ko', 'KO', { finish: true }),
    m('tko', 'TKO', { finish: true }),
    m('rtd', 'Retired (RTD)', { finish: true }),
    m('decision_unanimous', 'Unanimous decision', { distance: true }),
    m('decision_split', 'Split decision', { distance: true }),
    m('decision_majority', 'Majority decision', { distance: true }),
    m('dq', 'Disqualification'),
  ],
  wrestling: [
    m('pin', 'Pin (fall)', { finish: true }),
    m('tech_fall', 'Technical fall', { finish: true }),
    m('major_decision', 'Major decision', { distance: true }),
    m('decision', 'Decision', { distance: true }),
    m('forfeit', 'Forfeit'),
    m('injury_default', 'Injury default'),
    m('dq', 'Disqualification'),
  ],
  bjj: [
    m('submission', 'Submission', { finish: true }),
    m('points', 'Points', { distance: true }),
    m('advantages', 'Advantages', { distance: true }),
    m('referee_decision', 'Referee decision', { distance: true }),
    m('dq', 'Disqualification'),
  ],
};

export interface ChoiceDef {
  value: string;
  label: string;
}
const c = (value: string, label: string): ChoiceDef => ({ value, label });

/** The bout's context choices, per sport (all optional; weight class and the format are every sport's). */
export const BOUT_CONTEXT_BY_SPORT: Readonly<Record<CombatSportKey, { level?: readonly ChoiceDef[]; style?: readonly ChoiceDef[]; gi?: readonly ChoiceDef[]; belt?: readonly ChoiceDef[] }>> = {
  mma: { level: [c('amateur', 'Amateur'), c('pro', 'Pro')] },
  boxing: { level: [c('amateur', 'Amateur'), c('pro', 'Pro')] },
  wrestling: { style: [c('folkstyle', 'Folkstyle'), c('freestyle', 'Freestyle'), c('greco', 'Greco-Roman')] },
  bjj: {
    gi: [c('gi', 'Gi'), c('nogi', 'No-gi')],
    belt: [c('white', 'White'), c('blue', 'Blue'), c('purple', 'Purple'), c('brown', 'Brown'), c('black', 'Black'), c('grey', 'Grey (kids)'), c('yellow', 'Yellow (kids)'), c('orange', 'Orange (kids)'), c('green', 'Green (kids)')],
  },
};

export interface BoutContext {
  weight_class?: string;
  /** Rounds scheduled and their length. */
  format?: { rounds: number; minutes: number };
  level?: string;
  style?: string;
  gi?: string;
  belt?: string;
}

export interface Bout {
  result: BoutResult;
  method?: string;
  /** The round it ended in (finishes; 1-based). */
  round?: number;
  /** Seconds into that round. */
  time_s?: number;
  context?: BoutContext;
}

const WEIGHT_CLASS_MAX = 40;
const ROUNDS_MAX = 15;
const ROUND_MINUTES_MAX = 15;

/**
 * A bout for `sport`, or the first problem by name. A method must be the
 * sport's; a round / time only on a finish-or-other (never on a decision —
 * those go the distance), the round within the rounds scheduled when given,
 * the time within the round's length. Unknown keys are refused.
 */
export function validateBout(sport: string, raw: unknown): { ok: true; value: Bout } | { ok: false; error: string } {
  if (!isCombatSport(sport)) return { ok: false, error: 'Bout results are for combat sports' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'The bout must be an object' };
  const b = raw as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!['result', 'method', 'round', 'time_s', 'context'].includes(k)) return { ok: false, error: `Unknown bout field "${k}"` };
  if (!(BOUT_RESULTS as readonly unknown[]).includes(b.result)) return { ok: false, error: 'The result must be W, L, D or NC' };
  const out: Bout = { result: b.result as BoutResult };
  let method: MethodDef | undefined;
  if (b.method !== undefined) {
    method = BOUT_METHODS_BY_SPORT[sport].find(x => x.value === b.method);
    if (!method) return { ok: false, error: 'That is not a way this sport’s bouts end' };
    out.method = method.value;
  }
  let ctx: BoutContext | undefined;
  if (b.context !== undefined) {
    const parsed = validateContext(sport, b.context);
    if (!parsed.ok) return parsed;
    ctx = parsed.value;
    if (Object.keys(ctx).length > 0) out.context = ctx;
  }
  const minutes = ctx?.format?.minutes;
  if (b.round !== undefined) {
    if (method?.distance) return { ok: false, error: 'A decision goes the distance — no round' };
    if (typeof b.round !== 'number' || !Number.isInteger(b.round) || b.round < 1 || b.round > ROUNDS_MAX) return { ok: false, error: 'The round must be 1–15' };
    if (ctx?.format && b.round > ctx.format.rounds) return { ok: false, error: 'The round is past the rounds scheduled' };
    out.round = b.round;
  }
  if (b.time_s !== undefined) {
    if (method?.distance) return { ok: false, error: 'A decision goes the distance — no time' };
    if (out.round === undefined) return { ok: false, error: 'A time needs its round' };
    const cap = (minutes ?? ROUND_MINUTES_MAX) * 60;
    if (typeof b.time_s !== 'number' || !Number.isInteger(b.time_s) || b.time_s < 0 || b.time_s > cap) return { ok: false, error: 'The time is outside the round' };
    out.time_s = b.time_s;
  }
  return { ok: true, value: out };
}

function validateContext(sport: CombatSportKey, raw: unknown): { ok: true; value: BoutContext } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'The bout context must be an object' };
  const r = raw as Record<string, unknown>;
  const allowed = BOUT_CONTEXT_BY_SPORT[sport];
  const out: BoutContext = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'weight_class') {
      if (typeof v !== 'string' || !v.trim() || v.trim().length > WEIGHT_CLASS_MAX) return { ok: false, error: 'The weight class must be a short name' };
      out.weight_class = v.trim();
    } else if (k === 'format') {
      const f = v as { rounds?: unknown; minutes?: unknown } | null;
      const okRounds = !!f && typeof f.rounds === 'number' && Number.isInteger(f.rounds) && f.rounds >= 1 && f.rounds <= ROUNDS_MAX;
      const okMinutes = !!f && typeof f.minutes === 'number' && f.minutes > 0 && f.minutes <= ROUND_MINUTES_MAX;
      if (!okRounds || !okMinutes || Object.keys(f!).length !== 2) return { ok: false, error: 'The format is rounds × minutes' };
      out.format = { rounds: f!.rounds as number, minutes: f!.minutes as number };
    } else if (k === 'level' || k === 'style' || k === 'gi' || k === 'belt') {
      const choices = allowed[k];
      if (!choices) return { ok: false, error: `This sport’s bouts have no ${k}` };
      if (!choices.some(x => x.value === v)) return { ok: false, error: `That ${k} is not one of this sport’s` };
      out[k] = v as string;
    } else {
      return { ok: false, error: `Unknown bout context "${k}"` };
    }
  }
  return { ok: true, value: out };
}

/** The envelope's W / L / T for a bout: a draw is T, a no contest has none (never a win). */
export function envelopeResult(result: BoutResult): 'W' | 'L' | 'T' | undefined {
  return result === 'D' ? 'T' : result === 'NC' ? undefined : result;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function choiceLabel(list: readonly ChoiceDef[] | undefined, v: string | undefined): string | null {
  return v ? (list?.find(x => x.value === v)?.label ?? null) : null;
}

/**
 * "W · TKO · R2 1:47 · Pro · 155 lb", "W · Submission · No-gi · Purple",
 * "D · Majority decision", "NC". The card's and the feed's one headline.
 */
export function boutHeadline(sport: CombatSportKey, b: Bout, opts: { withResult?: boolean } = {}): string {
  const method = b.method ? BOUT_METHODS_BY_SPORT[sport].find(x => x.value === b.method)?.label : null;
  const when = b.round !== undefined ? `R${b.round}${b.time_s !== undefined ? ` ${clock(b.time_s)}` : ''}` : null;
  const ctx = BOUT_CONTEXT_BY_SPORT[sport];
  const parts = [
    opts.withResult === false ? null : b.result,
    method,
    when,
    choiceLabel(ctx.style, b.context?.style),
    choiceLabel(ctx.level, b.context?.level),
    choiceLabel(ctx.gi, b.context?.gi),
    choiceLabel(ctx.belt, b.context?.belt),
    b.context?.weight_class ?? null,
  ];
  return parts.filter(Boolean).join(' · ');
}

export interface BoutRecord {
  w: number;
  l: number;
  d: number;
  nc: number;
  finishes: number;
}

/** The record over bouts, and how many wins were finishes. */
export function recordFrom(sport: CombatSportKey, bouts: readonly Bout[]): BoutRecord {
  const r: BoutRecord = { w: 0, l: 0, d: 0, nc: 0, finishes: 0 };
  for (const b of bouts) {
    if (b.result === 'W') {
      r.w++;
      if (b.method && BOUT_METHODS_BY_SPORT[sport].find(x => x.value === b.method)?.finish) r.finishes++;
    } else if (b.result === 'L') r.l++;
    else if (b.result === 'D') r.d++;
    else r.nc++;
  }
  return r;
}

/** "3-1-1 (1 NC)" — wins, losses, draws; no contests only when there are any. */
export function formatRecord(r: BoutRecord): string {
  return `${r.w}-${r.l}-${r.d}${r.nc > 0 ? ` (${r.nc} NC)` : ''}`;
}
