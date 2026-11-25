// ── The strokes dial (Tom's live-round spec, Nov 25 2026) ────────────────────
// Pure, zero imports. Strokes are set on a round dial: a 270° sweep from
// −135° to +135° (0° is straight up, clockwise positive; the bottom 90° is
// open). The scale follows the hole: 0 strokes at −135°, DOUBLE PAR at
// +135°, so par is always at the top. Above double par the dial stays full
// and the number keeps counting. The component holds the pointer; this
// holds the numbers.

export const SCORE_DIAL_START = -135;
export const SCORE_DIAL_SWEEP = 270;
export const SCORE_DIAL_SIZE = 190;
export const SCORE_DIAL_CENTRE = 95;

/** The angle for `strokes` on a hole of `par`: −135 + 270 × min(1, n / 2·par). */
export function scoreDialAngle(strokes: number, par: number): number {
  if (!Number.isFinite(strokes) || !Number.isFinite(par) || par <= 0) return SCORE_DIAL_START;
  const share = Math.min(1, Math.max(0, strokes) / (2 * par));
  return SCORE_DIAL_START + SCORE_DIAL_SWEEP * share;
}

/** The strokes under a pointer at (dx, dy) from the dial's centre (screen
 *  axes: y grows downward). The angle is atan2(x, −y), clamped to the sweep
 *  — a pointer in the open bottom snaps to the nearer end — and the result
 *  moves in whole strokes, never below 1. */
export function strokesForPointer(dx: number, dy: number, par: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(par) || par <= 0) return 1;
  const raw = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const angle = Math.min(SCORE_DIAL_START + SCORE_DIAL_SWEEP, Math.max(SCORE_DIAL_START, raw));
  return Math.max(1, Math.round(((angle - SCORE_DIAL_START) / SCORE_DIAL_SWEEP) * 2 * par));
}

/** A point at `radius` and `angle` around (cx, cy), in SVG coordinates. */
export function dialPolar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
}

const fix = (n: number) => Math.round(n * 100) / 100;

/** An SVG arc path at `radius` from angle `from` to `to` (clockwise). */
export function dialArcPath(cx: number, cy: number, radius: number, from: number, to: number): string {
  const a = dialPolar(cx, cy, radius, from);
  const b = dialPolar(cx, cy, radius, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${fix(a.x)} ${fix(a.y)} A ${radius} ${radius} 0 ${large} 1 ${fix(b.x)} ${fix(b.y)}`;
}

/** One tick per whole stroke from 0 to double par, EXCEPT par (the fixed
 *  par hand sits there). */
export function scoreDialTicks(par: number): Array<{ value: number; angle: number }> {
  if (!Number.isFinite(par) || par <= 0) return [];
  const out: Array<{ value: number; angle: number }> = [];
  for (let n = 0; n <= 2 * par; n++) {
    if (n === par) continue;
    out.push({ value: n, angle: scoreDialAngle(n, par) });
  }
  return out;
}
