/**
 * White-balance eyedropper math (Phase 2, round E4d) — PURE, node-tested.
 * Given a pixel the user says SHOULD be neutral, invert the engine's own
 * WB stage (multiplicative: r×(1+T·s), g×(1−tint·s'), b×(1−T·s)) to find
 * the temperature/tint that equalize the channels:
 *   r(1+kT) = b(1−kT)        → T = (b−r) / (k(r+b))
 *   g(1−k'·tint) = balanced  → tint = (1 − balanced/g) / k'
 * Clamped to the slider range — a wildly colored "neutral" pick maxes the
 * sliders rather than exploding.
 */

import { WB_TEMP_SCALE, WB_TINT_SCALE } from './color-math';
import type { ColorAdjustments } from '../types';

const clampSigned = (v: number) => Math.max(-1, Math.min(1, v));

/** Temperature/tint that neutralize the given (0..1) sample. Returns
 *  zeros for degenerate samples (black, or a channel missing). */
export function neutralizeWhiteBalance(
  r: number,
  g: number,
  b: number
): Pick<ColorAdjustments, 'temperature' | 'tint'> {
  if (r + b < 1e-4 || g < 1e-4) return { temperature: 0, tint: 0 };
  const temperature = clampSigned((b - r) / (WB_TEMP_SCALE * (r + b)));
  const balanced = r * (1 + temperature * WB_TEMP_SCALE); // == b·(1−T·k) when unclamped
  const tint = clampSigned((1 - balanced / g) / WB_TINT_SCALE);
  return { temperature, tint };
}
