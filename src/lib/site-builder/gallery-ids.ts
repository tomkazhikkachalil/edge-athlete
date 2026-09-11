/**
 * The gallery's entry ids — Site Builder phase 11. ZERO IMPORTS on purpose:
 * `validate.ts` (the action schema) and `gallery.ts` (the entries) both read
 * this, and neither may import the other (validate → gallery → seeds →
 * layout would cycle back into validate).
 */
// Sep 11 2026: three more golf shapes (weekly league, points race, social) —
// appended, so the order still equals GALLERY_ENTRIES (gallery.test.ts pins it).
export const GALLERY_ENTRY_IDS = ['golf-clubhouse', 'golf-tour', 'team-clubhouse', 'team-scoreboard', 'community', 'simple', 'golf-weekly', 'golf-points-race', 'golf-social'] as const;
export type GalleryEntryId = (typeof GALLERY_ENTRY_IDS)[number];
export const GALLERY_MODES = ['keep', 'clean'] as const;
export type GalleryMode = (typeof GALLERY_MODES)[number];
