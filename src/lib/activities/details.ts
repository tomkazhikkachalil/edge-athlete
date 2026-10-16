// ── What the Finish sheet asks, per type (activities details, Oct 16 2026) ──
// Pure, zod only. ONE table drives the form, the server's validator, the
// pre-fill and the activity page's line, so a new question is one row here
// and a test — never a migration (`activities.details` is one jsonb object,
// 265).
//
// Tom's rules (his review, Oct 16):
// - every question is OPTIONAL; at most three show, the rest sit behind
//   "More details";
// - the next Finish of the same type PRE-FILLS choices and yes/no answers
//   only — a number (a temperature, watts, floors) always starts empty, so
//   last session's numbers are never saved quietly as this one's;
// - measured values are STORED metric (°C, kg, m) and shown in the
//   athlete's units (units.ts);
// - a field with a `column` is not stored in details: it is the row's own
//   avg_power / avg_cadence (a device's value wins over a typed one).
//
// Effort (1–10) and notes are asked for EVERY type and are columns of their
// own — not in this table. ZERO zod here (the feed card reads this file);
// the server's parser of a request is details-schema.ts.

import type { ActivityType } from './catalog';
import { isPoolLength, POOL_LENGTH_LABELS, POOL_LENGTHS, type PoolLength } from './pool';
import { formatQuantity, type Quantity, type UnitSystem } from './units';

export interface ChoiceOption {
  value: string;
  label: string;
}

interface FieldBase {
  key: string;
  label: string;
  /** Behind "More details" (and never counted among the three shown). */
  more?: boolean;
  /** Shown only when another field holds this value (e.g. the room's
   *  temperature only when heated = yes). */
  showIf?: { key: string; equals: string | boolean };
}

export type DetailField =
  | (FieldBase & { kind: 'choice'; options: readonly ChoiceOption[] })
  | (FieldBase & { kind: 'multi'; options: readonly ChoiceOption[] })
  | (FieldBase & { kind: 'bool' })
  | (FieldBase & {
      kind: 'number';
      /** A measured quantity converts with the athlete's units; a plain one has a fixed unit. */
      quantity?: Quantity;
      unit?: string;
      /** Bounds in the STORED unit. */
      min: number;
      max: number;
      integer?: boolean;
      /** Written to the row's own column instead of details. */
      column?: 'avg_power' | 'avg_cadence';
    })
  | (FieldBase & { kind: 'text'; max: number; placeholder?: string });

const opts = (...pairs: [string, string][]): ChoiceOption[] => pairs.map(([value, label]) => ({ value, label }));

export const STROKES = opts(['freestyle', 'Freestyle'], ['backstroke', 'Backstroke'], ['breaststroke', 'Breaststroke'], ['butterfly', 'Butterfly'], ['mixed', 'Mixed']);

/** The questions, per type, in the order the form shows them. */
export const DETAIL_FIELDS_BY_TYPE: Readonly<Partial<Record<ActivityType, readonly DetailField[]>>> = {
  swim: [
    { key: 'pool', kind: 'choice', label: 'Pool length', options: POOL_LENGTHS.map(p => ({ value: p, label: POOL_LENGTH_LABELS[p] })) },
    { key: 'stroke', kind: 'choice', label: 'Main stroke', options: STROKES },
  ],
  open_water_swim: [
    { key: 'water_temp_c', kind: 'number', label: 'Water temperature', quantity: 'temp', min: -2, max: 40 },
    { key: 'wetsuit', kind: 'bool', label: 'Wetsuit' },
  ],
  row: [
    { key: 'setting', kind: 'choice', label: 'Where', options: opts(['machine', 'Indoor machine'], ['water', 'On the water']) },
    { key: 'stroke_rate', kind: 'number', label: 'Stroke rate', unit: 'spm', min: 10, max: 60, integer: true, column: 'avg_cadence' },
    { key: 'watts', kind: 'number', label: 'Average watts', unit: 'W', min: 1, max: 1500, integer: true, column: 'avg_power' },
  ],
  treadmill: [{ key: 'incline_pct', kind: 'number', label: 'Incline', unit: '%', min: 0, max: 40 }],
  indoor_ride: [
    { key: 'watts', kind: 'number', label: 'Average watts', unit: 'W', min: 1, max: 2500, integer: true, column: 'avg_power' },
    { key: 'cadence', kind: 'number', label: 'Cadence', unit: 'rpm', min: 10, max: 200, integer: true, column: 'avg_cadence' },
    { key: 'platform', kind: 'choice', label: 'Platform', options: opts(['zwift', 'Zwift'], ['peloton', 'Peloton'], ['spin_class', 'Spin class'], ['other', 'Other']) },
  ],
  elliptical: [{ key: 'resistance', kind: 'number', label: 'Resistance level', unit: 'level', min: 1, max: 30, integer: true }],
  stair_climber: [
    { key: 'climbed', kind: 'number', label: 'Climbed', min: 1, max: 20000, integer: true },
    { key: 'climbed_unit', kind: 'choice', label: 'Counted in', options: opts(['floors', 'Floors'], ['steps', 'Steps']) },
  ],
  paddle: [{ key: 'craft', kind: 'choice', label: 'Craft', options: opts(['kayak', 'Kayak'], ['sup', 'SUP'], ['canoe', 'Canoe']) }],
  skate: [{ key: 'surface', kind: 'choice', label: 'Surface', options: opts(['ice', 'Ice'], ['inline', 'Inline']) }],
  // ── A7: the duration types, snow and hikes ──
  yoga: [
    { key: 'style', kind: 'choice', label: 'Style', options: opts(['vinyasa', 'Vinyasa'], ['hatha', 'Hatha'], ['yin', 'Yin'], ['power', 'Power'], ['ashtanga', 'Ashtanga'], ['restorative', 'Restorative'], ['other', 'Other']) },
    { key: 'heated', kind: 'bool', label: 'Heated' },
    { key: 'room_temp_c', kind: 'number', label: 'Room temperature', quantity: 'temp', min: 15, max: 50, showIf: { key: 'heated', equals: true } },
    { key: 'guided', kind: 'choice', label: 'How', options: opts(['class', 'Class'], ['self', 'Self-guided']) },
    { key: 'focus', kind: 'multi', label: 'Focus', more: true, options: opts(['hips', 'Hips'], ['back', 'Back'], ['balance', 'Balance'], ['flexibility', 'Flexibility'], ['strength', 'Strength']) },
    { key: 'poses', kind: 'text', label: 'Poses or sequence', more: true, max: 200, placeholder: 'Sun salutation B, pigeon…' },
  ],
  pilates: [
    { key: 'apparatus', kind: 'choice', label: 'Type', options: opts(['mat', 'Mat'], ['reformer', 'Reformer']) },
    { key: 'guided', kind: 'choice', label: 'How', options: opts(['class', 'Class'], ['self', 'Self-guided']) },
    { key: 'focus', kind: 'choice', label: 'Focus', options: opts(['core', 'Core'], ['full_body', 'Full body'], ['lower_body', 'Lower body']) },
  ],
  stretch: [
    { key: 'areas', kind: 'multi', label: 'Body areas', options: opts(['neck', 'Neck'], ['shoulders', 'Shoulders'], ['back', 'Back'], ['hips', 'Hips'], ['hamstrings', 'Hamstrings'], ['quads', 'Quads'], ['calves', 'Calves'], ['full_body', 'Full body']) },
    { key: 'purpose', kind: 'choice', label: 'Purpose', options: opts(['warm_up', 'Warm-up'], ['recovery', 'Recovery'], ['flexibility', 'Flexibility']) },
  ],
  hiit: [
    { key: 'format', kind: 'choice', label: 'Format', options: opts(['tabata', 'Tabata'], ['emom', 'EMOM'], ['amrap', 'AMRAP'], ['intervals', 'Intervals'], ['circuit', 'Circuit']) },
    { key: 'exercises', kind: 'text', label: 'Exercises', more: true, max: 200, placeholder: 'Burpees, kettlebell swings…' },
  ],
  martial_arts: [
    {
      key: 'discipline',
      kind: 'choice',
      label: 'Discipline',
      options: opts(['mma', 'MMA'], ['boxing', 'Boxing'], ['wrestling', 'Wrestling'], ['bjj', 'Jiu-jitsu'], ['judo', 'Judo'], ['karate', 'Karate'], ['taekwondo', 'Taekwondo'], ['muay_thai', 'Muay Thai'], ['kickboxing', 'Kickboxing']),
    },
    { key: 'session', kind: 'choice', label: 'Session', options: opts(['drilling', 'Drilling'], ['sparring', 'Sparring'], ['conditioning', 'Conditioning'], ['class', 'Class']) },
    { key: 'sparring_rounds', kind: 'number', label: 'Sparring rounds', min: 1, max: 60, integer: true, showIf: { key: 'session', equals: 'sparring' } },
    { key: 'rank', kind: 'text', label: 'Belt or rank', max: 40, placeholder: 'Blue belt' },
  ],
  dance: [
    { key: 'dance_style', kind: 'text', label: 'Style', max: 60, placeholder: 'Salsa, hip-hop, ballet…' },
    { key: 'guided', kind: 'choice', label: 'How', options: opts(['class', 'Class'], ['freestyle', 'Freestyle']) },
  ],
  ski: [{ key: 'terrain', kind: 'choice', label: 'Where', options: opts(['resort', 'Resort'], ['backcountry', 'Backcountry']) }],
  snowboard: [{ key: 'terrain', kind: 'choice', label: 'Where', options: opts(['resort', 'Resort'], ['backcountry', 'Backcountry']) }],
  xc_ski: [{ key: 'technique', kind: 'choice', label: 'Technique', options: opts(['classic', 'Classic'], ['skate', 'Skate']) }],
  hike: [{ key: 'pack_kg', kind: 'number', label: 'Pack weight', quantity: 'weight', min: 0.5, max: 60, more: true }],
};

/** At most this many questions show before "More details". */
export const SHOWN_MAX = 3;

export function detailFieldsFor(type: ActivityType): readonly DetailField[] {
  return DETAIL_FIELDS_BY_TYPE[type] ?? [];
}

/**
 * The fields shown up front and those behind "More details". A field with
 * a `showIf` is part of the question it hangs off (the room's temperature
 * belongs to "Heated"): it goes where its parent went and is not counted.
 */
export function splitFields(type: ActivityType): { shown: DetailField[]; more: DetailField[] } {
  const shown: DetailField[] = [];
  const more: DetailField[] = [];
  let counted = 0;
  for (const f of detailFieldsFor(type)) {
    if (f.showIf) {
      (shown.some(p => p.key === f.showIf!.key) ? shown : more).push(f);
      continue;
    }
    if (!f.more && counted < SHOWN_MAX) {
      shown.push(f);
      counted++;
    } else more.push(f);
  }
  return { shown, more };
}

/** A field is visible when its showIf (if any) holds in `values`. */
export function fieldVisible(f: DetailField, values: Record<string, unknown>): boolean {
  return !f.showIf || values[f.showIf.key] === f.showIf.equals;
}

export type DetailValue = string | string[] | number | boolean;
export type Details = Record<string, DetailValue>;

/** Whether one value is a valid answer to one field (zod-free: the feed
 *  reads this file, and zod stays out of the first download). */
export function validAnswer(f: DetailField, v: unknown): boolean {
  switch (f.kind) {
    case 'choice':
      return typeof v === 'string' && f.options.some(o => o.value === v);
    case 'multi':
      return Array.isArray(v) && v.length >= 1 && new Set(v).size === v.length && v.every(x => typeof x === 'string' && f.options.some(o => o.value === x));
    case 'bool':
      return typeof v === 'boolean';
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max && (!f.integer || Number.isInteger(v));
    case 'text':
      return typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= f.max;
  }
}

/** The fields stored in details (not those that are the row's own columns). */
export function storedFields(type: ActivityType): DetailField[] {
  return detailFieldsFor(type).filter(f => !(f.kind === 'number' && f.column));
}

export const EFFORT_MIN = 1;
export const EFFORT_MAX = 10;
export const NOTES_MAX = 2000;

/** Labels under three of the ten chips. */
export const EFFORT_LABELS: Readonly<Record<number, string>> = { 1: 'Very easy', 5: 'Moderate', 10: 'Max' };

/** A stored details value → what the type knows of it (an old or foreign key is dropped, never an error). */
export function detailsFromRow(type: ActivityType, raw: unknown): Details {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Details = {};
  const given = raw as Record<string, unknown>;
  for (const f of storedFields(type)) {
    const v = given[f.key];
    if (v !== undefined && validAnswer(f, v)) out[f.key] = (f.kind === 'text' ? (v as string).trim() : v) as DetailValue;
  }
  return withoutHiddenAnswers(type, out);
}

/** A sub-answer whose question no longer holds goes (a room temperature without "Heated"). */
export function withoutHiddenAnswers(type: ActivityType, details: Details): Details {
  const out = { ...details };
  for (const f of detailFieldsFor(type)) if (f.showIf && out[f.key] !== undefined && !fieldVisible(f, out)) delete out[f.key];
  return out;
}

/**
 * The next Finish's starting answers from the last activity of the same
 * type: choices, multi-choices and yes/no ONLY. Numbers and text start empty.
 */
export function prefillFrom(type: ActivityType, last: unknown): Details {
  const known = detailsFromRow(type, last);
  const out: Details = {};
  for (const f of detailFieldsFor(type)) {
    if ((f.kind === 'choice' || f.kind === 'multi' || f.kind === 'bool') && known[f.key] !== undefined) out[f.key] = known[f.key];
  }
  return out;
}

function valueText(f: DetailField, v: DetailValue, sys: UnitSystem): string | null {
  switch (f.kind) {
    case 'choice':
      return f.options.find(o => o.value === v)?.label ?? null;
    case 'multi':
      return Array.isArray(v) ? v.map(x => f.options.find(o => o.value === x)?.label).filter(Boolean).join(', ') || null : null;
    case 'bool':
      return v === true ? f.label : v === false ? `No ${f.label.toLowerCase()}` : null;
    case 'number':
      if (typeof v !== 'number') return null;
      if (f.quantity) return formatQuantity(f.quantity, v, sys);
      return f.unit ? `${Math.round(v * 10) / 10} ${f.unit}` : `${v}`;
    case 'text':
      return typeof v === 'string' ? v : null;
  }
}

/** One answer as "Label: value" parts for the page and the card. */
export function detailParts(type: ActivityType, details: Details, sys: UnitSystem): { key: string; label: string; value: string }[] {
  const out: { key: string; label: string; value: string }[] = [];
  for (const f of detailFieldsFor(type)) {
    if (f.kind === 'number' && f.column) continue;
    const v = details[f.key];
    if (v === undefined) continue;
    const text = valueText(f, v, sys);
    if (text) out.push({ key: f.key, label: f.label, value: text });
  }
  return out;
}

/**
 * The activity page's one line: "Pool 25 m · Freestyle", "Kayak". Types
 * whose answers read better joined to the unit field get it here
 * (a stair climber's "120 floors").
 */
export function detailLine(type: ActivityType, details: Details, sys: UnitSystem): string | null {
  const parts = detailParts(type, details, sys);
  if (type === 'stair_climber') {
    const n = details.climbed;
    const unit = details.climbed_unit === 'steps' ? 'steps' : 'floors';
    const rest = parts.filter(p => p.key !== 'climbed' && p.key !== 'climbed_unit').map(p => p.value);
    return [typeof n === 'number' ? `${n.toLocaleString()} ${unit}` : null, ...rest].filter(Boolean).join(' · ') || null;
  }
  const text = parts.map(p => (type === 'swim' && p.key === 'pool' ? `Pool ${p.value}` : p.value));
  return text.length > 0 ? text.join(' · ') : null;
}

/** A swim's pool, when answered. */
export function poolOf(details: Details): PoolLength | null {
  return isPoolLength(details.pool) ? details.pool : null;
}
