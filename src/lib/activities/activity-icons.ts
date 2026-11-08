/**
 * The activity types' glyphs (the icons round, Nov 2026), kept APART from the
 * catalog: catalog.ts is pure rules every page imports for labels and groups;
 * the glyphs ride only with the places that draw an activity's icon. The
 * catalog's `icon` is the Font Awesome NAME; this maps it.
 */
import type { FaIconDef } from '@/lib/icons/fa-icon';
import { faBicycle } from '@/lib/icons/fa/bicycle';
import { faBolt } from '@/lib/icons/fa/bolt';
import { faChildReaching } from '@/lib/icons/fa/child-reaching';
import { faHandFist } from '@/lib/icons/fa/hand-fist';
import { faHeartPulse } from '@/lib/icons/fa/heart-pulse';
import { faMedal } from '@/lib/icons/fa/medal';
import { faMountain } from '@/lib/icons/fa/mountain';
import { faMusic } from '@/lib/icons/fa/music';
import { faPersonBiking } from '@/lib/icons/fa/person-biking';
import { faPersonHiking } from '@/lib/icons/fa/person-hiking';
import { faPersonRunning } from '@/lib/icons/fa/person-running';
import { faPersonSkating } from '@/lib/icons/fa/person-skating';
import { faPersonSkiing } from '@/lib/icons/fa/person-skiing';
import { faPersonSkiingNordic } from '@/lib/icons/fa/person-skiing-nordic';
import { faPersonSnowboarding } from '@/lib/icons/fa/person-snowboarding';
import { faPersonSwimming } from '@/lib/icons/fa/person-swimming';
import { faPersonWalking } from '@/lib/icons/fa/person-walking';
import { faSpa } from '@/lib/icons/fa/spa';
import { faStairs } from '@/lib/icons/fa/stairs';
import { faStopwatch } from '@/lib/icons/fa/stopwatch';
import { faWater } from '@/lib/icons/fa/water';

const GLYPHS: Readonly<Record<string, FaIconDef>> = {
  'bicycle': faBicycle,
  'bolt': faBolt,
  'child-reaching': faChildReaching,
  'hand-fist': faHandFist,
  'heart-pulse': faHeartPulse,
  'medal': faMedal,
  'mountain': faMountain,
  'music': faMusic,
  'person-biking': faPersonBiking,
  'person-hiking': faPersonHiking,
  'person-running': faPersonRunning,
  'person-skating': faPersonSkating,
  'person-skiing': faPersonSkiing,
  'person-skiing-nordic': faPersonSkiingNordic,
  'person-snowboarding': faPersonSnowboarding,
  'person-swimming': faPersonSwimming,
  'person-walking': faPersonWalking,
  'spa': faSpa,
  'stairs': faStairs,
  'stopwatch': faStopwatch,
  'water': faWater,
};

/** The glyph for a catalog icon name; an unknown name draws the generic one. */
export function activityGlyph(name: string): FaIconDef {
  return GLYPHS[name] ?? GLYPHS['person-walking'] ?? Object.values(GLYPHS)[0];
}
