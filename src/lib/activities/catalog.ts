// ── Activity types (Activities program, Sep 29 2026) — pure, ZERO imports ──
// An activity (a run, a ride, a hike …) is NOT a sport: it is never a
// SportRegistry key and never writes athlete_performances (the training →
// post-category precedent; CLAUDE.md "Sport Adapter Pattern"). This list is
// the ONE vocabulary, mirrored by 245's activities_activity_type_check — a
// new type is a migration widening that CHECK plus an entry here (the
// catalog test pins the two equal).
//
// Zero imports on purpose: the feed card, the profile tab and the import
// sheet all read it from client chunks.

export const ACTIVITY_TYPES = [
  'run',
  'trail_run',
  'walk',
  'hike',
  'ride',
  'mountain_bike',
  'swim',
  'row',
  'ski',
  'climb',
  'other',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** How a type's speed reads: a pace (time per distance) or a speed. */
export type PaceStyle = 'pace' | 'speed' | 'swim_pace';

export interface ActivityTypeDef {
  label: string;
  /** Font Awesome 7 solid icon name (without the `fa-` prefix). */
  icon: string;
  paceStyle: PaceStyle;
  /** Below this speed (m/s) between two samples, the athlete is stopped. */
  movingSpeed: number;
  /** A sustained speed above this (m/s) is not this activity — a car, a
   *  train, a GPS jump. Samples faster than 3× this are dropped as glitches. */
  maxSpeed: number;
}

export const ACTIVITY_TYPE_DEFS: Readonly<Record<ActivityType, ActivityTypeDef>> = {
  run: { label: 'Run', icon: 'person-running', paceStyle: 'pace', movingSpeed: 0.8, maxSpeed: 12 },
  trail_run: { label: 'Trail run', icon: 'person-running', paceStyle: 'pace', movingSpeed: 0.6, maxSpeed: 10 },
  walk: { label: 'Walk', icon: 'person-walking', paceStyle: 'pace', movingSpeed: 0.4, maxSpeed: 4 },
  hike: { label: 'Hike', icon: 'person-hiking', paceStyle: 'pace', movingSpeed: 0.3, maxSpeed: 4 },
  ride: { label: 'Ride', icon: 'person-biking', paceStyle: 'speed', movingSpeed: 1.5, maxSpeed: 30 },
  mountain_bike: { label: 'Mountain bike', icon: 'person-biking', paceStyle: 'speed', movingSpeed: 1, maxSpeed: 25 },
  swim: { label: 'Swim', icon: 'person-swimming', paceStyle: 'swim_pace', movingSpeed: 0.2, maxSpeed: 3 },
  row: { label: 'Row', icon: 'water', paceStyle: 'pace', movingSpeed: 0.5, maxSpeed: 7 },
  ski: { label: 'Ski', icon: 'person-skiing', paceStyle: 'speed', movingSpeed: 1, maxSpeed: 45 },
  climb: { label: 'Climb', icon: 'mountain', paceStyle: 'speed', movingSpeed: 0.1, maxSpeed: 3 },
  other: { label: 'Activity', icon: 'stopwatch', paceStyle: 'speed', movingSpeed: 0.5, maxSpeed: 45 },
};

export function isActivityType(v: unknown): v is ActivityType {
  return typeof v === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(v);
}

/** A file's own sport word (GPX `<type>`, TCX `Sport=`, FIT `sport`/`sub_sport`
 *  as strings) → our type. Unknown words are `other`, never a guess. */
export function activityTypeFromWord(sport: string | null | undefined, subSport?: string | null): ActivityType {
  const s = (sport ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const sub = (subSport ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (s.includes('run')) return sub.includes('trail') || s.includes('trail') ? 'trail_run' : 'run';
  if (s === 'biking' || s.includes('cycl') || s.includes('ride') || s.includes('bike') || s.includes('biking')) {
    return sub.includes('mountain') || s.includes('mountain') || s === 'mtb' ? 'mountain_bike' : 'ride';
  }
  if (s.includes('hik')) return 'hike';
  if (s.includes('walk')) return 'walk';
  if (s.includes('swim')) return 'swim';
  if (s.includes('row')) return 'row';
  if (s.includes('ski') || s.includes('snowboard')) return 'ski';
  if (s.includes('climb')) return 'climb';
  return 'other';
}
