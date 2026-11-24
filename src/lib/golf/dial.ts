// ── The course dials (the mechanical dialect, Nov 23 2026) ───────────────────
// Pure, zero imports. Tom's visual spec: three dials on a picked course —
// Yards, Rating, Slope — each a 270° sweep from -135° to +135° (0 is straight
// up, open at the bottom). The needle's angle is linear in the value and
// CLAMPED to the scale; no value (no tee chosen, an unrated course) rests the
// needle at the start and the readout shows a dash, never a made-up number.

export interface DialScale {
  min: number;
  max: number;
}

export const DIAL_SWEEP_START = -135;
export const DIAL_SWEEP = 270;

/** The spec's ranges. A 9-hole course's yardage sits low on the Yards dial —
 *  the scale is the card's, and the readout carries the exact number. */
export const DIAL_SCALES = {
  yards: { min: 5000, max: 7200 },
  rating: { min: 64, max: 78 },
  slope: { min: 110, max: 145 },
} as const satisfies Record<string, DialScale>;

export type DialKind = keyof typeof DIAL_SCALES;

/** Any value → a finite number, or null (the dash). Strings are the form's
 *  own ("71.2"); blank, junk, zero and negatives are "no value". */
export function dialValue(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Needle angle in degrees: -135 + 270 × (value − min) / (max − min), clamped. */
export function dialAngle(value: number | null, scale: DialScale): number {
  if (value === null || !Number.isFinite(value) || scale.max <= scale.min) return DIAL_SWEEP_START;
  const t = (value - scale.min) / (scale.max - scale.min);
  return DIAL_SWEEP_START + DIAL_SWEEP * Math.min(1, Math.max(0, t));
}

/** What the readout under a dial says. Yards with a thousands comma, rating
 *  to one decimal, slope whole; "—" for no value. */
export function dialReadout(kind: DialKind, value: number | null): string {
  if (value === null) return '—';
  if (kind === 'yards') return Math.round(value).toLocaleString('en-US');
  if (kind === 'rating') return value.toFixed(1);
  return String(Math.round(value));
}

/** A point on a circle around the dial's centre, for a tick or an arc end.
 *  0° is straight up, positive is clockwise (the needle's convention). */
export function dialPoint(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  const round = (n: number) => Math.round(n * 100) / 100;
  return { x: round(cx + radius * Math.sin(rad)), y: round(cy - radius * Math.cos(rad)) };
}
