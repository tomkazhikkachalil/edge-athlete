/**
 * Site templates (phase 6b B2) — pure, zero imports, node-tested.
 *
 * A template is a bundle of RENDER decisions the (public) layout and the
 * home body consult; the DB only stores the id (org_sites.template_id,
 * CHECK widened by 170). Unknown/legacy ids resolve to 'classic', so a
 * row from a newer build never breaks an older render.
 *
 * 'classic' is today's markup byte-for-byte. 'bold' is the first real
 * alternative: a full-width band header (strong accent, white text, nav
 * INSIDE the band), a full-bleed hero, a two-column section grid at
 * ≥ sm, tile teams, compact card density, uppercase-tracking headings.
 */

export const TEMPLATE_IDS = ['classic', 'bold'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export interface TemplateSpec {
  id: TemplateId;
  name: string;
  description: string;
  /** Header shape: the classic white bar + nav strip, or one dark band. */
  header: 'bar' | 'band';
  /** Home hero: a rounded gradient card, or a full-bleed gradient. */
  hero: 'card' | 'bleed';
  /** Home sections: a single stack, or a two-column grid at ≥ sm. */
  sections: 'stack' | 'grid';
  /** Home teams: name chips, or a tile grid. */
  teams: 'chips' | 'tiles';
  density: 'comfortable' | 'compact';
}

const SPECS: Record<TemplateId, TemplateSpec> = {
  classic: {
    id: 'classic',
    name: 'Classic',
    description: 'A white header, a gradient welcome card, and one column of sections.',
    header: 'bar',
    hero: 'card',
    sections: 'stack',
    teams: 'chips',
    density: 'comfortable',
  },
  bold: {
    id: 'bold',
    name: 'Bold',
    description: 'A full-width colour band with the menu inside, a big welcome, and a two-column layout.',
    header: 'band',
    hero: 'bleed',
    sections: 'grid',
    teams: 'tiles',
    density: 'compact',
  },
};

export function isTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Never throws; anything unknown is 'classic'. */
export function templateSpec(id: unknown): TemplateSpec {
  return SPECS[isTemplateId(id) ? id : 'classic'];
}

/** Modules that always span the full width in the grid template. */
export const FULL_WIDTH_MODULES: ReadonlySet<string> = new Set([
  'teams',
  'news',
  'gallery',
  'courses',
  'leaders',
]);
