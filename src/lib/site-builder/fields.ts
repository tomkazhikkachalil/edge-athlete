/**
 * Field descriptors for the properties panel — Site Builder phase 5.
 *
 * A typed, explicit description of what the panel shows for a widget —
 * pinned to the zod schemas by test (`config-fields.test.ts`) rather than
 * derived from them: a form's needs (kind, label, help, scope) are not a
 * schema's. CLIENT-SAFE: no zod, no imports beyond types (the editor
 * bundle reads it; schemas.ts imports the caps from here, never the
 * reverse).
 *
 * `scope` decides where a value goes:
 *  • 'instance' → the layout instance's config — one undo step per field
 *    burst, autosaved with the layout;
 *  • 'content'  → the org object, through the console's existing PATCH
 *    action (set_hero, set_contact) — the same write the Website section
 *    makes, so the two surfaces can never disagree.
 *
 * Phase 6 adds three editor kinds for the content widgets, whose content
 * IS the instance: `blocks` (the text widget's compact block editor),
 * `image` (a photo from the site's assets, uploaded here) and `embed` (a
 * pasted link, parsed into a structure).
 */
import type { SiteWidgetKey } from './catalog';

export type FieldSpec =
  | { kind: 'text' | 'textarea' | 'url' | 'email' | 'date'; name: string; label: string; help?: string; max?: number; scope: 'instance' | 'content' }
  | { kind: 'visibility'; name: 'visibility'; label: string; scope: 'instance' }
  | { kind: 'blocks'; name: 'blocks'; label: string; help?: string; scope: 'instance' }
  | { kind: 'image'; name: 'path'; label: string; help?: string; scope: 'instance' }
  | { kind: 'embed'; name: 'embed'; label: string; help?: string; scope: 'instance' };

/** Content-widget caps (schemas.ts enforces them; the editors show them). */
export const TEXT_WIDGET_BLOCKS_MAX = 12;
export const IMAGE_ALT_MAX = 200;
export const IMAGE_CAPTION_MAX = 200;

const TITLE: FieldSpec = { kind: 'text', name: 'title', label: 'Section title', help: 'Shown as this section’s heading on the page.', max: 60, scope: 'instance' };
const VISIBILITY: FieldSpec = { kind: 'visibility', name: 'visibility', label: 'Who sees it', scope: 'instance' };

/** The hero's CONTENT fields — set_hero's payload (whole-object replace). */
export const HERO_FIELDS: FieldSpec[] = [
  { kind: 'text', name: 'headline', label: 'Headline', max: 80, scope: 'content' },
  { kind: 'text', name: 'tagline', label: 'Tagline', max: 140, scope: 'content' },
  { kind: 'text', name: 'ctaLabel', label: 'Button label', help: 'A button needs both a label and a link.', max: 24, scope: 'content' },
  { kind: 'url', name: 'ctaUrl', label: 'Button link', max: 200, scope: 'content' },
  { kind: 'text', name: 'notice', label: 'Notice', help: 'A banner every page carries until the date below.', max: 200, scope: 'content' },
  { kind: 'date', name: 'noticeUntil', label: 'Notice until', scope: 'content' },
];

/** The contact card's CONTENT fields — set_contact's payload. */
export const CONTACT_FIELDS: FieldSpec[] = [
  { kind: 'email', name: 'email', label: 'Email', max: 200, scope: 'content' },
  { kind: 'text', name: 'phone', label: 'Phone', max: 40, scope: 'content' },
  { kind: 'url', name: 'website', label: 'Website', max: 200, scope: 'content' },
  { kind: 'textarea', name: 'hours', label: 'Hours', max: 200, scope: 'content' },
  { kind: 'url', name: 'directionsUrl', label: 'Directions link', max: 200, scope: 'content' },
];

/** Phase 6 — the text widget: its blocks ARE the instance. */
export const TEXT_FIELDS: FieldSpec[] = [
  { kind: 'blocks', name: 'blocks', label: 'Content', help: 'Paragraphs, headings and link lists. Nothing shows to visitors until you publish.', scope: 'instance' },
];

/** Phase 6 — the image widget: one photo from the site's assets. */
export const IMAGE_FIELDS: FieldSpec[] = [
  { kind: 'image', name: 'path', label: 'Photo', scope: 'instance' },
  { kind: 'text', name: 'alt', label: 'Describe the photo', help: 'Read aloud by screen readers; shown if the photo cannot load.', max: IMAGE_ALT_MAX, scope: 'instance' },
  { kind: 'text', name: 'caption', label: 'Caption', max: IMAGE_CAPTION_MAX, scope: 'instance' },
  { kind: 'url', name: 'href', label: 'Link', help: 'Where a tap on the photo goes — an https:// address.', max: 200, scope: 'instance' },
];

/** Phase 6 — the embed widget: a pasted link, stored as a structure. */
export const EMBED_FIELDS: FieldSpec[] = [
  { kind: 'embed', name: 'embed', label: 'Video or map link', help: 'Paste a YouTube, Vimeo or OpenStreetMap link.', scope: 'instance' },
];

/** Every non-hero widget gets the instance options; content fields where
 *  the org object has a simple form; the content widgets' editors. Lists
 *  (sponsors, documents) and media picks (gallery, course photos) stay in
 *  the console. */
export function fieldsFor(key: SiteWidgetKey): FieldSpec[] {
  switch (key) {
    case 'hero':
      return HERO_FIELDS;
    case 'contact':
      return [TITLE, VISIBILITY, ...CONTACT_FIELDS];
    case 'text':
      return [TITLE, VISIBILITY, ...TEXT_FIELDS];
    case 'image':
      return [TITLE, VISIBILITY, ...IMAGE_FIELDS];
    case 'embed':
      return [TITLE, VISIBILITY, ...EMBED_FIELDS];
    default:
      return [TITLE, VISIBILITY];
  }
}

/** The content fields' PATCH action, per widget. */
export function contentActionFor(key: SiteWidgetKey): 'set_hero' | 'set_contact' | null {
  return key === 'hero' ? 'set_hero' : key === 'contact' ? 'set_contact' : null;
}
