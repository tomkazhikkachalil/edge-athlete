// ── Metric or imperial for everything measured (Oct 16 2026) — pure ─────────
// Tom's review: room and water temperature, pack weight, pool length and a
// lift's weight follow the athlete's own unit setting. ONE setting decides
// it — the viewer's km / mi choice (format.ts readUnitPreference) — and
// every value is STORED metric (°C, kg, m) and converted only on screen.

import type { DistanceUnit } from './format';

export type UnitSystem = 'metric' | 'imperial';

export const unitSystemOf = (unit: DistanceUnit): UnitSystem => (unit === 'mi' ? 'imperial' : 'metric');

export type Quantity = 'temp' | 'weight' | 'length';

export const QUANTITY_UNITS: Readonly<Record<Quantity, Record<UnitSystem, string>>> = {
  temp: { metric: '°C', imperial: '°F' },
  weight: { metric: 'kg', imperial: 'lb' },
  length: { metric: 'm', imperial: 'yd' },
};

const LB_PER_KG = 2.2046226218;
const YD_PER_M = 1 / 0.9144;

/** A stored (metric) value → the system's number. */
export function toDisplay(q: Quantity, metric: number, sys: UnitSystem): number {
  if (sys === 'metric') return metric;
  if (q === 'temp') return metric * 1.8 + 32;
  if (q === 'weight') return metric * LB_PER_KG;
  return metric * YD_PER_M;
}

/** A number typed in the system's unit → the stored metric value. */
export function fromInput(q: Quantity, value: number, sys: UnitSystem): number {
  if (sys === 'metric') return value;
  if (q === 'temp') return (value - 32) / 1.8;
  if (q === 'weight') return value / LB_PER_KG;
  return value / YD_PER_M;
}

/** "40 °C" / "104 °F" — rounded to what anyone says. */
export function formatQuantity(q: Quantity, metric: number, sys: UnitSystem): string {
  const v = toDisplay(q, metric, sys);
  const shown = q === 'weight' && v < 20 ? Math.round(v * 10) / 10 : Math.round(v);
  return `${shown} ${QUANTITY_UNITS[q][sys]}`;
}
