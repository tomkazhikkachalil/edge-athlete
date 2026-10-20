// ── The sport setup as short steps (Program D, Oct 2026) — pure ─────────────
// Tom: the long per-sport form becomes a few short steps. The steps are
// DERIVED from the sport's settings schema, never written per sport:
//   1. "About you in {sport}" — the `preferences` group (a field with no
//      group is a preference), ≤ 5 fields a step; a second chunk reads
//      "More about you in {sport}".
//   2. "Competitive profile" — the `competitive` group, minus personal bests.
//   3. "Personal bests" — the `pb_*` keys (track & field; ≤ 8, no split).
//   4. "Review" — every field's value, then Save.
// An EMPTY group yields no step (swimming, cycling, running, rowing and
// track & field have no preferences). Every key of the schema lands in
// exactly one step; the Review step owns none. Imports are TYPES only, so
// this module stays importable anywhere.

import type { SettingsFieldDef, SportSettingsSchema } from './settings-schemas';
import { settingsToDisplayItems } from './settings-schemas';

export const STEP_FIELDS_MAX = 5;
/** Personal bests are one list; a step of them may run to eight (five events today). */
export const PB_STEP_FIELDS_MAX = 8;

export interface SetupStep {
  id: string;
  label: string;
  /** The schema keys this step edits; empty for Review. */
  keys: string[];
}

export const REVIEW_STEP_ID = 'review';

export function isPersonalBestKey(key: string): boolean {
  return key.startsWith('pb_');
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** The steps a sport's setup walks, from its schema. `sportName` is the display name ("Golf"). */
export function stepsForSchema(schema: SportSettingsSchema, sportName: string): SetupStep[] {
  const prefs: SettingsFieldDef[] = schema.fields.filter(f => (f.group ?? 'preferences') === 'preferences');
  const competitive = schema.fields.filter(f => f.group === 'competitive' && !isPersonalBestKey(f.key));
  const bests = schema.fields.filter(f => f.group === 'competitive' && isPersonalBestKey(f.key));
  const steps: SetupStep[] = [];
  chunk(prefs, STEP_FIELDS_MAX).forEach((fields, i) => {
    steps.push({ id: i === 0 ? 'about' : `about-${i + 1}`, label: i === 0 ? `About you in ${sportName}` : `More about you in ${sportName}`, keys: fields.map(f => f.key) });
  });
  chunk(competitive, STEP_FIELDS_MAX).forEach((fields, i) => {
    steps.push({ id: i === 0 ? 'competitive' : `competitive-${i + 1}`, label: i === 0 ? 'Competitive profile' : 'More competitive profile', keys: fields.map(f => f.key) });
  });
  chunk(bests, PB_STEP_FIELDS_MAX).forEach((fields, i) => {
    steps.push({ id: i === 0 ? 'bests' : `bests-${i + 1}`, label: i === 0 ? 'Personal bests' : 'More personal bests', keys: fields.map(f => f.key) });
  });
  steps.push({ id: REVIEW_STEP_ID, label: 'Review', keys: [] });
  return steps;
}

/** The step that owns a field — where a validation error sends the athlete back to. */
export function stepIndexForKey(steps: SetupStep[], key: string): number {
  const i = steps.findIndex(s => s.keys.includes(key));
  return i < 0 ? 0 : i;
}

/**
 * The one line under a sport's row on the Sports tab: the first `max` set
 * values, in schema order, joined with " · " — the same labels the profile
 * chips show (settingsToDisplayItems). "" when nothing is set.
 */
export function summaryLine(schema: SportSettingsSchema, settings: Record<string, unknown> | null | undefined, max = 3): string {
  return settingsToDisplayItems(schema, settings).slice(0, max).map(i => i.value).join(' · ');
}
