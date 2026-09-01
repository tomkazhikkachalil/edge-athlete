// ── Sport composer slot map ───────────────────────────────────────────────────
// CreatePostModal is sport-agnostic: it owns the general path and the
// stat-line path, and renders ONE slot where a sport's bespoke composer UI
// goes. Golf is the only sport with a bespoke composer today; a future sport
// with its own deep composer adds a section component here (a stat-line sport
// needs nothing — see src/lib/sports/stat-schemas.ts).

import type { ComponentType } from 'react';
import type { SportKey } from '@/lib/sports/SportRegistry';
import GolfComposerSection, { type GolfComposerValue } from '@/components/golf/GolfComposerSection';

/** The value a sport section reports up. Golf-only today; future bespoke
 *  sports widen this into a discriminated union. */
export type SportComposerValue = GolfComposerValue;

export interface SportComposerExtraProps {
  userId: string;
  /** True while this section's sport is the composer's selected post type.
   *  Sections stay MOUNTED while inactive so their state survives switching
   *  sports and back — before extraction the state lived inline in
   *  CreatePostModal and outlived the postType toggle the same way. Reset
   *  happens by remount: CreatePostModal keys the slot on its reset counter. */
  active: boolean;
  /** Fires on every internal change with everything the parent's submit,
   *  validation, footer-hint and preview paths read. */
  onChange: (value: SportComposerValue) => void;
  /** "Generate caption from scorecard" — the caption box belongs to the parent. */
  onCaptionGenerated: (caption: string) => void;
  /** Crash-draft restore (G1, Sep 2026): a previously reported value to
   *  seed the section's initial state from. Read ONCE as useState
   *  initializers — the slot is remount-keyed, so a new seed only takes
   *  effect through a remount, matching the reset-by-remount contract. */
  seed?: SportComposerValue;
}

export const SPORT_COMPOSER_EXTRAS: Partial<Record<SportKey, ComponentType<SportComposerExtraProps>>> = {
  golf: GolfComposerSection,
};
