/**
 * One Font Awesome glyph as data (the icons round, Nov 2026): its symbol id in
 * the sprite and its box. The PATH lives in the sprite (public/icons/fa-<hash>.svg,
 * one static, cached file drawn through <use>), so a route's JavaScript carries
 * nothing per icon — the first cut put the paths in these modules and every
 * route grew ~40 KB gzipped. Generated into src/lib/icons/fa/<name>.ts by
 * scripts/gen-fa-icons.mjs from @fortawesome/fontawesome-free's SVGs — the
 * SAME glyphs the app always drew, without the 90 KB stylesheet and 259 KB of
 * font files every page used to load. A site imports exactly the icons it draws.
 *
 * Icons: CC BY 4.0 (Fonticons, Inc. — https://fontawesome.com/license/free);
 * the attribution travels in every generated file's header.
 */
export interface FaIconDef {
  /** The symbol's id in the sprite: the name, with `-regular` / `-brands` for those styles. */
  readonly id: string;
  /** The FA name this came from (after aliases: `times` → `xmark`). */
  readonly name: string;
  /** The viewBox width (FA glyphs are 512 high; widths vary) — the box the glyph is drawn in. */
  readonly w: number;
  readonly h: number;
}
