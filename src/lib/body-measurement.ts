/**
 * Body-measurement conversions and rules for the Vitals quick-update flow
 * (VitalsSettingsModal → POST /api/vitals/body-measurement).
 *
 * Two stores must stay coherent: profiles (height_cm / weight_display /
 * weight_unit / weight_kg — the "Current Vitals" snapshot) and athlete_vitals
 * (the append-only dated timeline). The timeline is chart-fed by raw `value`
 * (metricSeries), so each metric's value must stay in ONE canonical unit
 * regardless of what the athlete typed: height in inches, weight in lbs —
 * the units vitals-config.ts declares for the body metrics.
 */

import { VITAL_METRICS_MAP } from '@/lib/vitals-config';

export type WeightUnit = 'lbs' | 'kg' | 'stone';

export const WEIGHT_UNITS: WeightUnit[] = ['lbs', 'kg', 'stone'];

/** profiles.height_cm bounds — 3'0"–8'11", matching parseHeightToCm. */
export const HEIGHT_CM_MIN = 91;
export const HEIGHT_CM_MAX = 272;

/** Canonical-lbs bounds, matching validateWeight's messaging. */
export const WEIGHT_LBS_MIN = 50;
export const WEIGHT_LBS_MAX = 500;

/**
 * Timeline value (whole-ish inches, 1dp) + display like 5'10".
 * Display derives from ROUNDED whole inches so 182.5cm can never render
 * as 5'12" — the naive floor/round split in formatHeight has that edge.
 */
export function convertHeight(heightCm: number): { valueIn: number; display: string } {
  const totalInches = heightCm / 2.54;
  const wholeInches = Math.round(totalInches);
  const feet = Math.floor(wholeInches / 12);
  const inches = wholeInches % 12;
  return {
    valueIn: Math.round(totalInches * 10) / 10,
    display: `${feet}'${inches}"`,
  };
}

/**
 * Timeline value in canonical lbs; weight_kg via the EXACT formula
 * PUT /api/profile uses (kg passthrough, stone ×6.35029, lbs ×0.453592,
 * 2dp) so both write paths derive identical kg; display in the unit the
 * athlete chose.
 */
export function convertWeight(
  display: number,
  unit: WeightUnit
): { valueLbs: number; valueKg: number; displayText: string } {
  const lbs = unit === 'lbs' ? display : unit === 'kg' ? display * 2.20462 : display * 14;
  const valueKg =
    unit === 'kg'
      ? display
      : unit === 'stone'
        ? Math.round(display * 6.35029 * 100) / 100
        : Math.round(display * 0.453592 * 100) / 100;
  return {
    valueLbs: Math.round(lbs * 10) / 10,
    valueKg,
    displayText: `${display} ${unit === 'stone' ? 'st' : unit}`,
  };
}

/**
 * Current Vitals mirrors the newest-DATED measurement we know of. `>=` so a
 * same-day re-entry (a correction) wins the profile; the timeline keeps both
 * rows — it is append-only by design.
 */
export function isNewestEntry(
  recordedAt: string,
  existingMaxRecordedAt: string | null
): boolean {
  return existingMaxRecordedAt === null || recordedAt >= existingMaxRecordedAt;
}

/**
 * YYYY-MM-DD, a real calendar date, not before 1900, and not after server
 * today + 1 day (client timezones can be ahead of the server).
 */
export function isValidRecordedDate(s: string, now: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1900) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return false;
  }
  const max = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  return s <= max.toISOString().slice(0, 10);
}

// ── The timeline rows, and the Edit Profile path onto them ──────────────────
// Two writers append body measurements: POST /api/vitals/body-measurement
// (the Vitals gear) and PUT /api/profile (Edit Profile's Vitals tab — until
// Sep 30 2026 that path updated the profile snapshot only, so a height or
// weight changed there never appeared on the Vitals chart). Both build their
// rows HERE so the two can never disagree on units or labels.

/** One athlete_vitals row for a height, in canonical inches. */
export function heightRow(profileId: string, recordedAt: string, heightCm: number): Record<string, unknown> {
  const conv = convertHeight(heightCm);
  return {
    profile_id: profileId,
    metric_key: 'height',
    metric_category: 'body',
    metric_label: VITAL_METRICS_MAP['height'].label,
    value: conv.valueIn,
    value_display: conv.display,
    unit: 'in',
    source: 'manual',
    recorded_at: recordedAt,
  };
}

/** One athlete_vitals row for a weight, in canonical lbs (display in the athlete's unit). */
export function weightRow(profileId: string, recordedAt: string, display: number, unit: WeightUnit): Record<string, unknown> {
  const conv = convertWeight(display, unit);
  return {
    profile_id: profileId,
    metric_key: 'weight',
    metric_category: 'body',
    metric_label: VITAL_METRICS_MAP['weight'].label,
    value: conv.valueLbs,
    value_display: conv.displayText,
    unit: 'lbs',
    source: 'manual',
    recorded_at: recordedAt,
  };
}

export interface ProfileEditMeasurement {
  /** Rows to append BEFORE the profile update (deleted again if it fails). */
  rows: Record<string, unknown>[];
  /** A refusal, named for the person — nothing is written. */
  error?: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * What a profile edit adds to the timeline. Only when the edit carries the
 * viewer's local day (`measuredOn` — Edit Profile sends it; no other PUT
 * caller does, so their behaviour is unchanged), and only for a value that
 * is PRESENT, non-empty and DIFFERENT from the stored one: an untouched
 * field adds nothing, and clearing a value adds nothing. A value outside
 * the chart's bounds is refused by name (the Vitals gear's own bounds).
 */
export function measurementFromProfileEdit(
  payload: Record<string, unknown>,
  stored: Record<string, unknown> | null,
  profileId: string,
  measuredOn: string | null
): ProfileEditMeasurement {
  const rows: Record<string, unknown>[] = [];
  if (!measuredOn) return { rows };

  const height = 'height_cm' in payload ? num(payload.height_cm) : null;
  if (height !== null) {
    if (height < HEIGHT_CM_MIN || height > HEIGHT_CM_MAX) {
      return { rows: [], error: `Height must be between 3'0" and 8'11"` };
    }
    const before = num(stored?.height_cm);
    if (before === null || Math.round(before) !== Math.round(height)) {
      rows.push(heightRow(profileId, measuredOn, height));
    }
  }

  const weight = 'weight_display' in payload ? num(payload.weight_display) : null;
  if (weight !== null && weight > 0) {
    const unit = (WEIGHT_UNITS as string[]).includes(payload.weight_unit as string)
      ? (payload.weight_unit as WeightUnit)
      : 'lbs';
    const { valueLbs } = convertWeight(weight, unit);
    if (valueLbs < WEIGHT_LBS_MIN || valueLbs > WEIGHT_LBS_MAX) {
      return { rows: [], error: `Weight must be between ${WEIGHT_LBS_MIN} and ${WEIGHT_LBS_MAX} lbs` };
    }
    const before = num(stored?.weight_display);
    const beforeUnit = (stored?.weight_unit as string | null | undefined) || 'lbs';
    if (before === null || before !== weight || beforeUnit !== unit) {
      rows.push(weightRow(profileId, measuredOn, weight, unit));
    }
  }

  return { rows };
}
