/**
 * Which layout the editor's canvas shows — Site Builder backlog B1. Pure:
 * - a DRAFT with a stored layout → that layout;
 * - a draft WITHOUT one (a restore of a revision taken before the grid, or
 *   a pre-grid draft) → the draft's own SEED, never the published layout —
 *   before, the canvas showed the arrangement the manager had just restored
 *   away from, and the next autosave wrote it back;
 * - no draft → the published layout, else the seed (a fresh draft after a
 *   publish inherits the published layout on creation).
 */

import type { SiteLayout } from './layout';

export function canvasLayoutFor(input: { hasDraft: boolean; stored: SiteLayout | null; published: SiteLayout | null; seed: () => SiteLayout }): SiteLayout {
  if (input.hasDraft) return input.stored ?? input.seed();
  return input.published ?? input.seed();
}
