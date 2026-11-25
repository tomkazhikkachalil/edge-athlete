// ── A colour per player in a round (Tom's live-round spec, Nov 25 2026) ──────
// Pure, zero imports. Golf had no per-player colour before this: the scoring
// card's tabs, the current hole key and a tab's ring wear the player's.
//
// The palette must never be green, gold, yellow, orange or red — on the card
// those hues MEAN something (par or better, eagle, double, penalties, triple).
// The first three are the spec's own; the rest keep to violet / blue / teal /
// magenta / slate. Assigned by the player's place in the round (the creator
// first, the order the round lists them), and it repeats past the end.

export const PLAYER_COLOURS = ['#8B5CF6', '#4DA3FF', '#2DD4BF', '#E879F9', '#94A3B8', '#818CF8', '#22D3EE', '#C084FC'] as const;

export function playerColour(index: number): string {
  const n = PLAYER_COLOURS.length;
  const i = Number.isInteger(index) && index >= 0 ? index % n : 0;
  return PLAYER_COLOURS[i];
}

/** `#RRGGBB` at an alpha, as rgb() — color-mix is above the browser floor. */
export function colourAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const a = Math.min(1, Math.max(0, alpha));
  return `rgb(${parseInt(m[1], 16)} ${parseInt(m[2], 16)} ${parseInt(m[3], 16)} / ${a})`;
}

/** The hue of a hex colour in degrees (for the test that keeps the palette
 *  out of the score colours' hues). */
export function hueOf(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 0;
  const [r, g, b] = [m[1], m[2], m[3]].map(v => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}
