/**
 * The organizer's format options (Events program, phase 2 — 207
 * `sport_events.format_config`) — pure. Strict: every key must be known
 * and well-formed, a miss is a 400 naming `format_config.<path>` — never a
 * clamp, never a silent strip (a typo must never be a silent no-op).
 *
 *   cut: after round K (1 .. roundCount − 1), EXACTLY ONE of
 *        top_n (1..500 — ties at the nth place all make it) or
 *        to_par (−20..40 — everyone at or under it plays on).
 *   null / absent cut clears it. `stableford` is reserved (parked).
 *   match (phase 3, 212): {sides: singles | fourball | foursomes, bracket,
 *        allowance?: 0..100} — on a MATCH format only; `cut` and `match`
 *        never coexist (a cut on a match format, a match config on a
 *        stroke format: 400s by name). A match format with no `match` key
 *        reads as singles, no bracket, the WHS allowance (`readMatchConfig`).
 */
import { isMatchFormat, MATCH_SIDES, type CutRule, type FormatConfig, type MatchConfig, type MatchSides } from './types';
import type { Parsed } from './validate';

export const CUT_TOP_N_MAX = 500;
export const CUT_TO_PAR_MIN = -20;
export const CUT_TO_PAR_MAX = 40;

const KNOWN = new Set(['cut', 'match']);
const CUT_KEYS = new Set(['after_round', 'top_n', 'to_par']);
const MATCH_KEYS = new Set(['sides', 'bracket', 'allowance']);

/** The WHS handicap allowances (percent) per side shape. */
export const MATCH_ALLOWANCE_DEFAULT: Readonly<Record<MatchSides, number>> = { singles: 100, fourball: 90, foursomes: 50 };

export interface FormatConfigContext {
  roundCount: number;
  /** The event's format (the NEXT one when a PATCH changes both). */
  format: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseCutRule(body: unknown, ctx: { roundCount: number }, field = 'format_config.cut'): Parsed<CutRule> {
  if (!isRecord(body)) return { ok: false, error: `${field} must be an object` };
  for (const key of Object.keys(body)) if (!CUT_KEYS.has(key)) return { ok: false, error: `Unknown field: ${field}.${key}` };
  const after = body.after_round;
  const maxAfter = Math.max(0, ctx.roundCount - 1);
  if (typeof after !== 'number' || !Number.isInteger(after) || after < 1 || after > maxAfter) {
    return { ok: false, error: maxAfter < 1 ? `${field}.after_round needs at least two rounds` : `${field}.after_round must be a whole number from 1 to ${maxAfter}` };
  }
  const hasTop = body.top_n !== undefined && body.top_n !== null;
  const hasPar = body.to_par !== undefined && body.to_par !== null;
  if (hasTop === hasPar) return { ok: false, error: `${field} needs exactly one of top_n or to_par` };
  if (hasTop) {
    const n = body.top_n;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > CUT_TOP_N_MAX) return { ok: false, error: `${field}.top_n must be a whole number from 1 to ${CUT_TOP_N_MAX}` };
    return { ok: true, value: { after_round: after, top_n: n } };
  }
  const p = body.to_par;
  if (typeof p !== 'number' || !Number.isInteger(p) || p < CUT_TO_PAR_MIN || p > CUT_TO_PAR_MAX) return { ok: false, error: `${field}.to_par must be a whole number from ${CUT_TO_PAR_MIN} to ${CUT_TO_PAR_MAX}` };
  return { ok: true, value: { after_round: after, to_par: p } };
}

export function parseMatchConfig(body: unknown, field = 'format_config.match'): Parsed<MatchConfig> {
  if (!isRecord(body)) return { ok: false, error: `${field} must be an object` };
  for (const key of Object.keys(body)) if (!MATCH_KEYS.has(key)) return { ok: false, error: `Unknown field: ${field}.${key}` };
  const sides = body.sides;
  if (typeof sides !== 'string' || !(MATCH_SIDES as readonly string[]).includes(sides)) return { ok: false, error: `${field}.sides must be one of ${MATCH_SIDES.join(', ')}` };
  const bracket = body.bracket === undefined ? false : body.bracket;
  if (typeof bracket !== 'boolean') return { ok: false, error: `${field}.bracket must be true or false` };
  const out: MatchConfig = { sides: sides as MatchSides, bracket };
  if (body.allowance !== undefined && body.allowance !== null) {
    const a = body.allowance;
    if (typeof a !== 'number' || !Number.isInteger(a) || a < 0 || a > 100) return { ok: false, error: `${field}.allowance must be a whole number from 0 to 100` };
    out.allowance = a;
  }
  return { ok: true, value: out };
}

/** The whole `format_config` object; `{}`, `{cut: null}` and `{match: null}` all mean no options. */
export function parseFormatConfig(body: unknown, ctx: FormatConfigContext): Parsed<FormatConfig> {
  if (!isRecord(body)) return { ok: false, error: 'format_config must be an object' };
  for (const key of Object.keys(body)) if (!KNOWN.has(key)) return { ok: false, error: `Unknown field: format_config.${key}` };
  const out: FormatConfig = {};
  const match = isMatchFormat(ctx.format);
  if (body.cut !== undefined && body.cut !== null) {
    if (match) return { ok: false, error: 'format_config.cut is not allowed on a match-play format' };
    const cut = parseCutRule(body.cut, ctx);
    if (!cut.ok) return cut;
    out.cut = cut.value;
  }
  if (body.match !== undefined && body.match !== null) {
    if (!match) return { ok: false, error: 'format_config.match is only allowed on a match-play format' };
    const m = parseMatchConfig(body.match);
    if (!m.ok) return m;
    out.match = m.value;
  }
  return { ok: true, value: out };
}

/** The stored jsonb as the app reads it — tolerant (a row written by hand never breaks a read): an unparseable value reads as no options. */
export function readFormatConfig(raw: unknown, roundCount: number, format: string): FormatConfig {
  const parsed = parseFormatConfig(raw ?? {}, { roundCount: Math.max(roundCount, 2), format });
  return parsed.ok ? parsed.value : {};
}

/** The match options an event plays under: null on a stroke format; on a match format the stored `match` or the defaults (singles, no bracket, the WHS allowance). */
export function readMatchConfig(config: FormatConfig | null | undefined, format: string): (MatchConfig & { allowance: number }) | null {
  if (!isMatchFormat(format)) return null;
  const m = config?.match ?? { sides: 'singles' as const, bracket: false };
  return { sides: m.sides, bracket: m.bracket, allowance: typeof m.allowance === 'number' ? m.allowance : MATCH_ALLOWANCE_DEFAULT[m.sides] };
}

/** "Cut after round 2 · top 20" / "Cut after round 2 · +4 or better". */
export function cutLabel(cut: CutRule | null | undefined): string | null {
  if (!cut) return null;
  const head = `Cut after round ${cut.after_round}`;
  if (typeof cut.top_n === 'number') return `${head} · top ${cut.top_n}`;
  if (typeof cut.to_par === 'number') return `${head} · ${cut.to_par === 0 ? 'even' : cut.to_par > 0 ? `+${cut.to_par}` : `−${Math.abs(cut.to_par)}`} or better`;
  return head;
}
