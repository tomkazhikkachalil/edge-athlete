// ── A range slider's numbers (the mechanical dialect, Nov 27 2026) ──────────
// Pure, zero imports. `RangeSlider` holds the pointer; this holds the sums:
// where the key sits for a value, which value a point on the track means,
// and what a key press does. Whole steps only.

export interface RangeScale {
  min: number;
  max: number;
  step: number;
}

/** The value snapped to a step and held inside the scale. */
export function rangeClamp(value: number, scale: RangeScale): number {
  if (!Number.isFinite(value)) return scale.min;
  const step = scale.step > 0 ? scale.step : 1;
  const snapped = scale.min + Math.round((value - scale.min) / step) * step;
  return Math.min(scale.max, Math.max(scale.min, snapped));
}

/** 0 at the scale's start, 1 at its end. */
export function rangeFraction(value: number, scale: RangeScale): number {
  if (scale.max <= scale.min) return 0;
  return (rangeClamp(value, scale) - scale.min) / (scale.max - scale.min);
}

/** How far the key's centre can travel in a track this wide: the key stays
 *  wholly inside its track at both ends. */
export function rangeTravel(trackWidth: number, keyWidth: number): number {
  if (!Number.isFinite(trackWidth)) return 0;
  return Math.max(0, trackWidth - keyWidth);
}

/** The key's left offset for a value. */
export function rangeOffset(value: number, scale: RangeScale, travel: number): number {
  return rangeFraction(value, scale) * Math.max(0, travel);
}

/** The value under a pointer `x` px from the track's left edge (the key is
 *  centred on the pointer). A track with no travel keeps the start value. */
export function rangeValueAt(x: number, keyWidth: number, travel: number, scale: RangeScale): number {
  if (!Number.isFinite(x) || travel <= 0) return scale.min;
  const fraction = Math.min(1, Math.max(0, (x - keyWidth / 2) / travel));
  return rangeClamp(scale.min + fraction * (scale.max - scale.min), scale);
}

/** A key press on the slider: arrows move one step, Page keys `page` steps,
 *  Home / End jump to the ends. Null for a key the slider does not own. */
export function rangeKeyStep(key: string, value: number, scale: RangeScale, page = 5): number | null {
  const step = scale.step > 0 ? scale.step : 1;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowUp':
      return rangeClamp(value + step, scale);
    case 'ArrowLeft':
    case 'ArrowDown':
      return rangeClamp(value - step, scale);
    case 'PageUp':
      return rangeClamp(value + step * page, scale);
    case 'PageDown':
      return rangeClamp(value - step * page, scale);
    case 'Home':
      return scale.min;
    case 'End':
      return scale.max;
    default:
      return null;
  }
}
