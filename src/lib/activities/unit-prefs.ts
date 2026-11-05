// ── The unit system on the account (Oct 29 2026, migration 293) — pure ──────
// Tom: the °F / °C toggle on the golf round's Conditions step is remembered
// on the ACCOUNT so it follows the person across rounds and devices; his
// call: it is the ONE Metric / Imperial preference Settings → Account already
// offers (temperatures, distances, weights), moved from the device to the
// account. The column is `unknown` to the app — every read goes through
// `sanitizeUnitSystem`; the device's localStorage copy (format.ts,
// `ea.activities.unit`, 'km' | 'mi') is the cache and the signed-out value.
// Zero imports: the device key's words are spelled here once more on purpose.

export type UnitSystem = 'metric' | 'imperial';
export type DeviceUnit = 'km' | 'mi';

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'];

/** Any value → a unit system, or null when it is not one (junk, NULL, absent). */
export function sanitizeUnitSystem(raw: unknown): UnitSystem | null {
  return raw === 'metric' || raw === 'imperial' ? raw : null;
}

/** The account's choice wins when it has one; otherwise the device's. */
export function resolveUnitSystem(account: unknown, device: DeviceUnit): UnitSystem {
  return sanitizeUnitSystem(account) ?? (device === 'mi' ? 'imperial' : 'metric');
}

/** The device key's word for a system (the cache is written in km / mi). */
export function deviceUnitOf(sys: UnitSystem): DeviceUnit {
  return sys === 'imperial' ? 'mi' : 'km';
}

/** The system a temperature unit names — the Conditions step's toggle. */
export function unitSystemOfTemp(unit: '°F' | '°C'): UnitSystem {
  return unit === '°F' ? 'imperial' : 'metric';
}
