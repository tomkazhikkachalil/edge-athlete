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
