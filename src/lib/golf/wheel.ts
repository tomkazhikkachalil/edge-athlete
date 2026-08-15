// ── Number-wheel geometry and keyboard ────────────────────────────────────────
// Pure helpers behind NumberWheel, extracted so the scroll↔value mapping and
// the key bindings are unit-testable (the component itself has no test
// harness — no jsdom), matching how score-entry.ts is split from the modal.
//
// The wheel is a scroll container whose items are all one fixed height, padded
// top and bottom by half the visible window so the first and last values can
// reach the centre line. Value N therefore sits at scrollTop (N - min) * item.

/** Row height. 44px is the touch-target floor, and the CLIPPING RULE forbids
 *  faking it with an `after:` extender inside a scroll container — so the rows
 *  are genuinely this tall. */
export const WHEEL_ITEM_H = 44;

/** Rows visible at once. Odd, so exactly one is centred. Kept small: the modal
 *  footer competes for the same 90dvh budget. */
export const WHEEL_VISIBLE = 3;

/** Scrollport height, and the padding each end needs for the extremes to centre. */
export const WHEEL_HEIGHT = WHEEL_ITEM_H * WHEEL_VISIBLE;
export const WHEEL_PAD = WHEEL_ITEM_H * Math.floor(WHEEL_VISIBLE / 2);

export function clampToRange(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Every value the wheel offers, low to high. */
export function wheelValues(min: number, max: number): number[] {
  if (max < min) return [min];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}

/** Which value is centred at this scroll offset. Rounds, so a half-scrolled
 *  wheel resolves to whichever row is nearest the centre line. */
export function valueForScrollTop(
  scrollTop: number,
  min: number,
  max: number,
  itemHeight: number = WHEEL_ITEM_H
): number {
  if (itemHeight <= 0) return min;
  return clampToRange(min + Math.round(scrollTop / itemHeight), min, max);
}

/** Where to scroll so `value` sits on the centre line. Inverse of the above. */
export function scrollTopForValue(
  value: number,
  min: number,
  max: number,
  itemHeight: number = WHEEL_ITEM_H
): number {
  return (clampToRange(value, min, max) - min) * itemHeight;
}

/**
 * The next value for a key press, or `null` when the key is not ours — the
 * caller passes those through rather than swallowing them (the
 * return-null-if-unhandled shape mirrors useTypeahead's onKeyDown contract).
 *
 * Page steps by 5 because a golf wheel is short; Home/End go to the bounds.
 */
export function nextValueForKey(
  current: number,
  key: string,
  min: number,
  max: number
): number | null {
  const at = clampToRange(current, min, max);
  switch (key) {
    // Up on a wheel means "smaller number rises into view" — matching the
    // visual order, where lower values sit above.
    case 'ArrowUp':   return clampToRange(at - 1, min, max);
    case 'ArrowDown': return clampToRange(at + 1, min, max);
    case 'PageUp':    return clampToRange(at - 5, min, max);
    case 'PageDown':  return clampToRange(at + 5, min, max);
    case 'Home':      return min;
    case 'End':       return max;
    default:          return null;
  }
}

/**
 * Typing digits picks a value directly. Returns the value plus the buffer to
 * carry forward, so "1" then "2" reaches 12 rather than stopping at 1.
 *
 * A buffered number beyond `max` restarts from the new digit — otherwise
 * typing 1,5 on a 0-10 wheel would clamp to 10 and then refuse to move.
 */
export function valueForTypedDigit(
  digit: string,
  buffer: string,
  min: number,
  max: number
): { value: number; buffer: string } | null {
  if (!/^[0-9]$/.test(digit)) return null;
  const combined = Number(buffer + digit);
  if (buffer && combined <= max && combined >= min) {
    return { value: combined, buffer: buffer + digit };
  }
  const single = Number(digit);
  return { value: clampToRange(single, min, max), buffer: digit };
}
