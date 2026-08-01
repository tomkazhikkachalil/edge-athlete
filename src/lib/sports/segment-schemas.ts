/**
 * Per-sport SEGMENT schemas — what one slice of an event is called.
 *
 * A hole in golf, an inning in baseball, a quarter in basketball, a set in
 * tennis, a lap in track. Media attaches to a segment so a photo taken on
 * hole 3 shows up ON hole 3, and the same layout serves every sport with only
 * the label changing.
 *
 * This exists because `group_post_media.hole_number` was the ONE golf-specific
 * thing in an otherwise sport-neutral table — `group_posts`,
 * `group_post_participants` and `group_post_media` are all documented in their
 * own DDL as "generic multi-participant posts for any sport or activity type".
 * Building the media-per-moment feature on `hole_number` would have meant
 * rebuilding it for sport #2.
 *
 * ADDING A SPORT = 1 edit: add an entry to SPORT_SEGMENT_SCHEMAS.
 * No component, API or migration changes.
 *
 * NOT on `SportDefinition` in SportRegistry deliberately: that is a TOTAL
 * `Record<SportKey, …>`, so a required `segment` field would force swimming and
 * training to invent a segment noun they do not have. A `Partial` map states
 * "some sports have segments" correctly, and matches the two sibling precedents
 * (`stat-schemas.ts`, `settings-schemas.ts`).
 *
 * Bounds live HERE, not in a database CHECK constraint. The old
 * `hole_number BETWEEN 1 AND 18` meant every new sport needed a migration —
 * which is exactly the coupling this file removes.
 */

import type { SportKey } from './SportRegistry';

/** Stored on each media row so it is self-describing without a join. */
export type SegmentKind = 'hole' | 'inning' | 'quarter' | 'set' | 'lap';

export interface SportSegmentSchema {
  sport_key: SportKey;
  kind: SegmentKind;
  /** Singular noun, e.g. "Hole". */
  label: string;
  /** Plural noun, e.g. "Holes". */
  labelPlural: string;
  /** Lowest valid segment number. */
  min: number;
  /**
   * Highest ordinary segment number. NOT a hard ceiling when `variable` is set
   * — extra innings and overtime are normal, not corrupt data.
   */
  max: number;
  /** True when play can legitimately run past `max` (extra innings, OT). */
  variable?: boolean;
}

export const SPORT_SEGMENT_SCHEMAS: Partial<Record<SportKey, SportSegmentSchema>> = {
  golf: {
    sport_key: 'golf',
    kind: 'hole',
    label: 'Hole',
    labelPlural: 'Holes',
    min: 1,
    max: 18,
  },
  baseball: {
    sport_key: 'baseball',
    kind: 'inning',
    label: 'Inning',
    labelPlural: 'Innings',
    min: 1,
    max: 9,
    // Extra innings are ordinary baseball, not bad input.
    variable: true,
  },
  basketball: {
    sport_key: 'basketball',
    kind: 'quarter',
    label: 'Quarter',
    labelPlural: 'Quarters',
    min: 1,
    max: 4,
    // Overtime periods continue the numbering.
    variable: true,
  },
  ice_hockey: {
    sport_key: 'ice_hockey',
    kind: 'quarter',
    label: 'Period',
    labelPlural: 'Periods',
    min: 1,
    max: 3,
    variable: true,
  },
  tennis: {
    sport_key: 'tennis',
    kind: 'set',
    label: 'Set',
    labelPlural: 'Sets',
    min: 1,
    max: 5,
  },
  volleyball: {
    sport_key: 'volleyball',
    kind: 'set',
    label: 'Set',
    labelPlural: 'Sets',
    min: 1,
    max: 5,
  },
  track_field: {
    sport_key: 'track_field',
    kind: 'lap',
    label: 'Lap',
    labelPlural: 'Laps',
    min: 1,
    max: 25,
    variable: true,
  },
};

/** The schema for a sport, or null when that sport has no segments. */
export function segmentSchemaFor(sportKey: SportKey | null | undefined): SportSegmentSchema | null {
  if (!sportKey) return null;
  return SPORT_SEGMENT_SCHEMAS[sportKey] ?? null;
}

/**
 * Human label for one segment: "Hole 3", "Inning 7".
 *
 * `null` means round/game-level media that belongs to the whole event rather
 * than a moment in it — deliberately NOT "Segment 0".
 */
export function segmentLabel(
  sportKey: SportKey | null | undefined,
  segmentNumber: number | null | undefined
): string {
  const schema = segmentSchemaFor(sportKey);
  if (segmentNumber === null || segmentNumber === undefined) {
    // The event as a whole. Uses the sport's own word where we have one.
    return schema ? 'Round' : 'Overall';
  }
  // A sport with no schema still gets a usable label rather than a crash —
  // the same "absence is a legal state" discipline as the sibling schema files.
  return schema ? `${schema.label} ${segmentNumber}` : `Segment ${segmentNumber}`;
}

/**
 * Is this a plausible segment number for the sport?
 *
 * Lenient by design where the sport is: `variable` sports accept anything at or
 * above `min`, because rejecting the 11th inning would be a bug, not a
 * safeguard. Sports with no schema accept any positive integer — we have no
 * grounds to reject one.
 */
export function isValidSegment(
  sportKey: SportKey | null | undefined,
  segmentNumber: number
): boolean {
  if (!Number.isInteger(segmentNumber)) return false;

  const schema = segmentSchemaFor(sportKey);
  if (!schema) return segmentNumber > 0;

  if (segmentNumber < schema.min) return false;
  return schema.variable ? true : segmentNumber <= schema.max;
}

/**
 * The ordinary segment numbers for a sport, for populating a picker.
 * Empty when the sport has no schema — the caller should fall back to free
 * entry rather than showing an empty dropdown.
 */
export function segmentOptions(sportKey: SportKey | null | undefined): number[] {
  const schema = segmentSchemaFor(sportKey);
  if (!schema) return [];
  return Array.from({ length: schema.max - schema.min + 1 }, (_, i) => schema.min + i);
}
