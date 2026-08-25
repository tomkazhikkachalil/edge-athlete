/**
 * A "look" (Phase 4, round E-W1) — the transferable half of an image
 * recipe: everything that styles COLOR AND TEXTURE, and nothing that is
 * tied to one photo's pixels. Copy/paste-edits, apply-to-all, and (E-W3)
 * saved user presets all move Looks around; geometry (crop/rotate/flip/
 * perspective), masks, clone stamps, and text overlays deliberately stay
 * put — pasting someone's crop onto a different photo is never what
 * anyone means by "same look".
 *
 * PURE, node-tested. The zod schema is exported because saved presets
 * (E-W3) persist Looks and must validate them as untrusted input.
 */

import { z } from 'zod';
import {
  isNeutral,
  isNeutralColor,
  isNeutralDetail,
  isNeutralLight,
} from './filters';
import { isNeutralGrain } from './engine/grain-math';
import { isNeutralHsl } from './engine/hsl-math';
import { isNeutralCurves } from './engine/curves-math';
import type { ImageRecipe } from './types';

export interface Look {
  adjustments: ImageRecipe['adjustments'];
  light: ImageRecipe['light'];
  color: ImageRecipe['color'];
  detail: ImageRecipe['detail'];
  filterId: ImageRecipe['filterId'];
  filterStrength: ImageRecipe['filterStrength'];
  hsl?: ImageRecipe['hsl'];
  curves?: ImageRecipe['curves'];
  grain?: ImageRecipe['grain'];
}

/** Deep-copied look from a recipe. */
export function extractLook(recipe: ImageRecipe): Look {
  return {
    adjustments: { ...recipe.adjustments },
    light: { ...recipe.light },
    color: { ...recipe.color },
    detail: { ...recipe.detail },
    filterId: recipe.filterId,
    filterStrength: recipe.filterStrength,
    hsl: recipe.hsl ? structuredClone(recipe.hsl) : undefined,
    curves: recipe.curves ? structuredClone(recipe.curves) : undefined,
    grain: recipe.grain ? { ...recipe.grain } : undefined,
  };
}

/** The look as a recipe patch — REPLACES color/texture fields wholesale
 *  (absent optional groups clear the target's: a look is a complete
 *  statement, not a merge). Feed to patchRecipe or spread onto a recipe. */
export function lookToPatch(look: Look): Partial<ImageRecipe> {
  return {
    adjustments: { ...look.adjustments },
    light: { ...look.light },
    color: { ...look.color },
    detail: { ...look.detail },
    filterId: look.filterId,
    filterStrength: look.filterStrength,
    hsl: look.hsl ? structuredClone(look.hsl) : undefined,
    curves: look.curves ? structuredClone(look.curves) : undefined,
    grain: look.grain ? { ...look.grain } : undefined,
  };
}

/** Apply a look onto a recipe, preserving everything photo-specific. */
export function applyLook(recipe: ImageRecipe, look: Look): ImageRecipe {
  return { ...recipe, ...lookToPatch(look) };
}

/** True when the look would change nothing on a default recipe — used to
 *  refuse copying/saving an empty look. */
export function isNeutralLook(look: Look): boolean {
  return (
    isNeutral(look.adjustments) &&
    isNeutralLight(look.light) &&
    isNeutralColor(look.color) &&
    isNeutralDetail(look.detail) &&
    look.filterId === null &&
    isNeutralHsl(look.hsl) &&
    isNeutralCurves(look.curves) &&
    isNeutralGrain(look.grain)
  );
}

// Schema mirrors the recipe field schemas (recipes.ts) — kept adjacent to
// the Look type so presets validate exactly what applyLook consumes. The
// image-recipe schema in recipes.ts remains the single authority for
// recipes; this validates STANDALONE looks (preset rows, pasted payloads).
const signed = () => z.number().min(-1).max(1);
const unsigned = () => z.number().min(0).max(1);
const legacy = () => z.number().min(0).max(2);
const hslBand = z.object({ hue: signed(), saturation: signed(), luminance: signed() });
const curve = z
  .array(z.object({ x: unsigned(), y: unsigned() }))
  .min(2)
  .max(8)
  .refine(pts => pts.every((p, i) => i === 0 || p.x > pts[i - 1].x));

export const lookSchema: z.ZodType<Look> = z.object({
  adjustments: z.object({ brightness: legacy(), contrast: legacy(), saturation: legacy() }),
  light: z.object({
    exposure: signed(),
    highlights: signed(),
    shadows: signed(),
    whites: signed(),
    blacks: signed(),
  }),
  color: z.object({ temperature: signed(), tint: signed(), vibrance: signed() }),
  detail: z.object({
    sharpen: unsigned(),
    clarity: unsigned(),
    noiseReduction: unsigned(),
    vignette: signed(),
  }),
  filterId: z.string().nullable(),
  filterStrength: unsigned(),
  hsl: z
    .object({
      red: hslBand.optional(),
      orange: hslBand.optional(),
      yellow: hslBand.optional(),
      green: hslBand.optional(),
      aqua: hslBand.optional(),
      blue: hslBand.optional(),
      purple: hslBand.optional(),
      magenta: hslBand.optional(),
    })
    .optional(),
  curves: z
    .object({ master: curve.optional(), r: curve.optional(), g: curve.optional(), b: curve.optional() })
    .optional(),
  grain: z.object({ amount: unsigned(), size: z.number().min(1).max(3) }).optional(),
});
