/**
 * Field descriptors for the properties panel — Site Builder phase 5.
 *
 * A typed, explicit description of what the panel shows for a widget —
 * pinned to the zod schemas by test (`fields.test.ts`) rather than derived
 * from them: a form's needs (kind, label, help, scope) are not a schema's.
 * CLIENT-SAFE: no zod, no imports beyond types (the editor bundle reads it).
 *
 * `scope` decides where a value goes:
 *  • 'instance' → the layout instance's config (title today) — one undo
 *    step, autosaved with the layout;
 *  • 'content'  → the org object, through the console's existing PATCH
 *    action (set_hero, set_contact) — the same write the Website section
 *    makes, so the two surfaces can never disagree.
 */
import type { WebWidgetKey } from './catalog';

export type FieldSpec =
  | { kind: 'text' | 'textarea' | 'url' | 'email' | 'date'; name: string; label: string; help?: string; max?: number; scope: 'instance' | 'content' }
  | { kind: 'visibility'; name: 'visibility'; label: string; scope: 'instance' };

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

/** Every non-hero widget gets the instance options; content fields where
 *  the org object has a simple form. Lists (sponsors, documents) and media
 *  (gallery picks, course photos) stay in the console for now (phase 6). */
export function fieldsFor(key: WebWidgetKey): FieldSpec[] {
  if (key === 'hero') return HERO_FIELDS;
  if (key === 'contact') return [TITLE, VISIBILITY, ...CONTACT_FIELDS];
  return [TITLE, VISIBILITY];
}

/** The content fields' PATCH action, per widget. */
export function contentActionFor(key: WebWidgetKey): 'set_hero' | 'set_contact' | null {
  return key === 'hero' ? 'set_hero' : key === 'contact' ? 'set_contact' : null;
}
