// ── The putting rule of an indoor round (Nov 27 2026) — pure, zero imports ──
// Tom's indoor course spec: a simulator round says how putts are handled for
// the whole round. Three modes, one always in force:
//   putt_out  every putt is played and counted (an outdoor round's rule)
//   gimme     a ball that stops inside N feet is holed for 1 putt (N 1–15)
//   auto_2    any ball on the green is holed for 2 putts
// It is SETUP only for now: the round stores it (migration 322,
// `putting_rule` + `gimme_feet` on golf_scorecard_data and golf_rounds); the
// scoring card does not read it yet. Outdoor rounds never carry one.

export const PUTTING_MODES = ['putt_out', 'gimme', 'auto_2'] as const;
export type PuttingMode = (typeof PUTTING_MODES)[number];

export const PUTTING_LABEL: Readonly<Record<PuttingMode, string>> = {
  putt_out: 'Putt out',
  gimme: 'Gimme',
  auto_2: 'Auto 2',
};

export const DEFAULT_PUTTING_MODE: PuttingMode = 'putt_out';
export const GIMME_MIN = 1;
export const GIMME_MAX = 15;
export const GIMME_DEFAULT = 6;

export interface PuttingRule {
  mode: PuttingMode;
  /** Feet, only while the mode is gimme. */
  gimmeFeet: number | null;
}

export function isPuttingMode(value: unknown): value is PuttingMode {
  return typeof value === 'string' && (PUTTING_MODES as readonly string[]).includes(value);
}

/** A whole number of feet inside the range; anything else is the default
 *  (a draft saved before the field existed, a hand-edited value). */
export function clampGimmeFeet(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return GIMME_DEFAULT;
  return Math.min(GIMME_MAX, Math.max(GIMME_MIN, Math.round(n)));
}

/** The mode a form holds: a known one, else Putt out. */
export function puttingModeOr(value: unknown): PuttingMode {
  return isPuttingMode(value) ? value : DEFAULT_PUTTING_MODE;
}

/** What the composer sends: nothing for an outdoor round; the mode, and the
 *  feet only for gimme, for an indoor one. */
export function puttingPayload(indoor: boolean, mode: PuttingMode, gimmeFeet: number): { putting_rule?: PuttingMode; gimme_feet?: number } {
  if (!indoor) return {};
  return mode === 'gimme' ? { putting_rule: mode, gimme_feet: clampGimmeFeet(gimmeFeet) } : { putting_rule: mode };
}

export const PUTTING_RULE_INVALID = 'putting_rule must be putt_out, gimme, or auto_2';
export const GIMME_FEET_INVALID = `gimme_feet must be a whole number from ${GIMME_MIN} to ${GIMME_MAX}`;

/** The write gate. An outdoor round has no rule, whatever was sent. An
 *  indoor round with nothing sent has none either (an older client, an
 *  organisation's event round): it reads as Putt out. A sent value must be
 *  right — never silently repaired. */
export function parsePuttingRule(
  roundType: unknown,
  mode: unknown,
  feet: unknown,
): { ok: true; rule: PuttingRule | null } | { ok: false; error: string } {
  if (roundType !== 'indoor') return { ok: true, rule: null };
  if (mode === undefined || mode === null) return { ok: true, rule: null };
  if (!isPuttingMode(mode)) return { ok: false, error: PUTTING_RULE_INVALID };
  if (mode !== 'gimme') return { ok: true, rule: { mode, gimmeFeet: null } };
  if (typeof feet !== 'number' || !Number.isInteger(feet) || feet < GIMME_MIN || feet > GIMME_MAX) {
    return { ok: false, error: GIMME_FEET_INVALID };
  }
  return { ok: true, rule: { mode, gimmeFeet: feet } };
}

/** The rule a stored round plays by: null for an outdoor round; an indoor
 *  round saved before the rule existed is Putt out. */
export function puttingRuleOf(row: { round_type?: string | null; putting_rule?: string | null; gimme_feet?: number | null }): PuttingRule | null {
  if (row.round_type !== 'indoor') return null;
  const mode = puttingModeOr(row.putting_rule);
  return { mode, gimmeFeet: mode === 'gimme' ? clampGimmeFeet(row.gimme_feet) : null };
}

/** The info key's one line for the mode in force. */
export function puttingInfoLine(mode: PuttingMode, gimmeFeet: number): string {
  if (mode === 'gimme') return `A ball that stops inside ${clampGimmeFeet(gimmeFeet)} ft is holed for 1 putt.`;
  if (mode === 'auto_2') return 'Any ball on the green is holed for 2 putts.';
  return 'Every putt is played and counted.';
}

/** The Start step's Putting row (Tom, Nov 27 2026): the rule in force, said
 *  in one line before the round goes live. */
export function puttingSummary(mode: PuttingMode, gimmeFeet: number): string {
  if (mode === 'gimme') return `Gimme · inside ${clampGimmeFeet(gimmeFeet)} ft, 1 putt`;
  if (mode === 'auto_2') return 'Auto 2 · on the green, 2 putts';
  return 'Putt out · every putt counts';
}
