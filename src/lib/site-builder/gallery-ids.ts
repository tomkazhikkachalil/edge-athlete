/**
 * The gallery's entry ids — Site Builder phase 11. ZERO IMPORTS on purpose:
 * `validate.ts` (the action schema) and `gallery.ts` (the entries) both read
 * this, and neither may import the other (validate → gallery → seeds →
 * layout would cycle back into validate).
 */
export const GALLERY_ENTRY_IDS = ['golf-clubhouse', 'golf-tour', 'team-clubhouse', 'team-scoreboard', 'community', 'simple'] as const;
export type GalleryEntryId = (typeof GALLERY_ENTRY_IDS)[number];
export const GALLERY_MODES = ['keep', 'clean'] as const;
export type GalleryMode = (typeof GALLERY_MODES)[number];
