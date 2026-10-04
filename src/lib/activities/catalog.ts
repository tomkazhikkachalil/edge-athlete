// ── Activity types (Activities program, Sep 29 2026) — pure, ZERO imports ──
// An activity (a run, a ride, a hike …) is NOT a sport until the athlete
// POSTS it as one (the share-time bridge, Live Activities program, Oct 4
// 2026): it is never a SportRegistry key itself and writes no
// athlete_performances row of its own. This list is the ONE vocabulary,
// mirrored by the LAST activities_activity_type_check in the chain (251
// widened 245's eleven to twenty-six, in THREE GROUPS — Tom: a broad, grouped
// list) — a new type is a migration widening that CHECK plus an entry here,
// in the same order (the catalog test pins the two equal).
//
// Zero imports on purpose: the feed card, the profile tab, the import sheet
// and the recorder all read it from client chunks.

export const ACTIVITY_TYPES = [
  // outdoor — GPS
  'run',
  'trail_run',
  'walk',
  'hike',
  'ride',
  'mountain_bike',
  'open_water_swim',
  'paddle',
  'ski',
  'xc_ski',
  'snowboard',
  'skate',
  // indoor — a timer, distance entered at finish
  'swim',
  'row',
  'indoor_ride',
  'treadmill',
  'elliptical',
  'stair_climber',
  // duration only
  'yoga',
  'pilates',
  'stretch',
  'hiit',
  'martial_arts',
  'dance',
  'climb',
  'other',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/**
 * Every way an activity can ARRIVE (mig 247, 251) — mirrored by the LAST
 * activities_source_check in the chain, pinned equal by the catalog test.
 * `file` is the import sheet; `upload_link` is the athlete's personal upload
 * link (the Apple Watch bridge); `live` is the phone recorder (251 — recorded
 * in the installed app, screen on); the rest are providers connected in
 * Settings. Naming a provider here connects nothing — it is the word its
 * adapter writes with once that provider's programme has admitted us
 * (connections.ts says which are live).
 */
export const ACTIVITY_SOURCES = [
  'file',
  'upload_link',
  'polar',
  'wahoo',
  'coros',
  'suunto',
  'garmin',
  'google_health',
  'live',
] as const;

export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export function isActivitySource(v: unknown): v is ActivitySource {
  return typeof v === 'string' && (ACTIVITY_SOURCES as readonly string[]).includes(v);
}

/** How a type's speed reads: a pace (time per distance) or a speed. */
export type PaceStyle = 'pace' | 'speed' | 'swim_pace';

/** The picker's three groups (Tom, Oct 4 2026). */
export type ActivityGroup = 'outdoor' | 'indoor' | 'duration';
export const ACTIVITY_GROUP_LABELS: Readonly<Record<ActivityGroup, string>> = {
  outdoor: 'Outdoor',
  indoor: 'Indoor',
  duration: 'Duration only',
};
/** How the recorder captures a type: a GPS track, a timer with the distance
 *  entered at finish, or a timer alone. */
export type ActivityRecording = 'gps' | 'timer' | 'duration';

export interface ActivityTypeDef {
  label: string;
  /** Font Awesome 7 solid icon name (without the `fa-` prefix). */
  icon: string;
  group: ActivityGroup;
  recording: ActivityRecording;
  paceStyle: PaceStyle;
  /** Below this speed (m/s) between two samples, the athlete is stopped. */
  movingSpeed: number;
  /** A sustained speed above this (m/s) is not this activity — a car, a
   *  train, a GPS jump. Samples faster than 3× this are dropped as glitches. */
  maxSpeed: number;
}

export const ACTIVITY_TYPE_DEFS: Readonly<Record<ActivityType, ActivityTypeDef>> = {
  // outdoor — GPS
  run: { label: 'Run', icon: 'person-running', group: 'outdoor', recording: 'gps', paceStyle: 'pace', movingSpeed: 0.8, maxSpeed: 12 },
  trail_run: { label: 'Trail run', icon: 'person-running', group: 'outdoor', recording: 'gps', paceStyle: 'pace', movingSpeed: 0.6, maxSpeed: 10 },
  walk: { label: 'Walk', icon: 'person-walking', group: 'outdoor', recording: 'gps', paceStyle: 'pace', movingSpeed: 0.4, maxSpeed: 4 },
  hike: { label: 'Hike', icon: 'person-hiking', group: 'outdoor', recording: 'gps', paceStyle: 'pace', movingSpeed: 0.3, maxSpeed: 4 },
  ride: { label: 'Ride', icon: 'person-biking', group: 'outdoor', recording: 'gps', paceStyle: 'speed', movingSpeed: 1.5, maxSpeed: 30 },
  mountain_bike: { label: 'Mountain bike', icon: 'person-biking', group: 'outdoor', recording: 'gps', paceStyle: 'speed', movingSpeed: 1, maxSpeed: 25 },
  open_water_swim: { label: 'Open-water swim', icon: 'person-swimming', group: 'outdoor', recording: 'gps', paceStyle: 'swim_pace', movingSpeed: 0.2, maxSpeed: 3 },
  paddle: { label: 'Paddle', icon: 'water', group: 'outdoor', recording: 'gps', paceStyle: 'speed', movingSpeed: 0.4, maxSpeed: 8 },
  ski: { label: 'Ski', icon: 'person-skiing', group: 'outdoor', recording: 'gps', paceStyle: 'speed', movingSpeed: 1, maxSpeed: 45 },
  xc_ski: { label: 'Cross-country ski', icon: 'person-skiing-nordic', group: 'outdoor', recording: 'gps', paceStyle: 'pace', movingSpeed: 0.6, maxSpeed: 15 },
  snowboard: { label: 'Snowboard', icon: 'person-snowboarding', group: 'outdoor', recording: 'gps', paceStyle: 'speed', movingSpeed: 1, maxSpeed: 40 },
  skate: { label: 'Skate', icon: 'person-skating', group: 'outdoor', recording: 'gps', paceStyle: 'speed', movingSpeed: 0.8, maxSpeed: 15 },
  // indoor — a timer, distance entered at finish
  swim: { label: 'Swim', icon: 'person-swimming', group: 'indoor', recording: 'timer', paceStyle: 'swim_pace', movingSpeed: 0.2, maxSpeed: 3 },
  row: { label: 'Row', icon: 'water', group: 'indoor', recording: 'timer', paceStyle: 'pace', movingSpeed: 0.5, maxSpeed: 7 },
  indoor_ride: { label: 'Indoor ride', icon: 'bicycle', group: 'indoor', recording: 'timer', paceStyle: 'speed', movingSpeed: 1.5, maxSpeed: 30 },
  treadmill: { label: 'Treadmill', icon: 'person-running', group: 'indoor', recording: 'timer', paceStyle: 'pace', movingSpeed: 0.4, maxSpeed: 12 },
  elliptical: { label: 'Elliptical', icon: 'heart-pulse', group: 'indoor', recording: 'timer', paceStyle: 'pace', movingSpeed: 0.4, maxSpeed: 8 },
  stair_climber: { label: 'Stair climber', icon: 'stairs', group: 'indoor', recording: 'timer', paceStyle: 'pace', movingSpeed: 0.1, maxSpeed: 3 },
  // duration only
  yoga: { label: 'Yoga', icon: 'spa', group: 'duration', recording: 'duration', paceStyle: 'speed', movingSpeed: 0.1, maxSpeed: 3 },
  pilates: { label: 'Pilates', icon: 'spa', group: 'duration', recording: 'duration', paceStyle: 'speed', movingSpeed: 0.1, maxSpeed: 3 },
  stretch: { label: 'Stretching', icon: 'child-reaching', group: 'duration', recording: 'duration', paceStyle: 'speed', movingSpeed: 0.1, maxSpeed: 3 },
  hiit: { label: 'HIIT', icon: 'bolt', group: 'duration', recording: 'duration', paceStyle: 'speed', movingSpeed: 0.3, maxSpeed: 8 },
  martial_arts: { label: 'Martial arts', icon: 'hand-fist', group: 'duration', recording: 'duration', paceStyle: 'speed', movingSpeed: 0.1, maxSpeed: 5 },
  dance: { label: 'Dance', icon: 'music', group: 'duration', recording: 'duration', paceStyle: 'speed', movingSpeed: 0.1, maxSpeed: 5 },
  climb: { label: 'Climb', icon: 'mountain', group: 'duration', recording: 'duration', paceStyle: 'speed', movingSpeed: 0.1, maxSpeed: 3 },
  other: { label: 'Activity', icon: 'stopwatch', group: 'duration', recording: 'duration', paceStyle: 'speed', movingSpeed: 0.5, maxSpeed: 45 },
};

/** The picker's order within each group — the catalog's own order. */
export function activityTypesInGroup(group: ActivityGroup): ActivityType[] {
  return ACTIVITY_TYPES.filter(t => ACTIVITY_TYPE_DEFS[t].group === group);
}

/** The types whose distance is walked or run — the only ones steps are estimated for. */
export const STEP_TYPES: ReadonlySet<ActivityType> = new Set<ActivityType>(['walk', 'hike', 'run', 'trail_run', 'treadmill']);

export function isActivityType(v: unknown): v is ActivityType {
  return typeof v === 'string' && (ACTIVITY_TYPES as readonly string[]).includes(v);
}

/** A file's own sport word (GPX `<type>`, TCX `Sport=`, FIT `sport`/`sub_sport`
 *  as strings) → our type. Unknown words are `other`, never a guess. */
export function activityTypeFromWord(sport: string | null | undefined, subSport?: string | null): ActivityType {
  const s = (sport ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const sub = (subSport ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const both = `${s} ${sub}`;
  if (s.includes('run')) {
    if (both.includes('treadmill') || both.includes('indoor')) return 'treadmill';
    return sub.includes('trail') || s.includes('trail') ? 'trail_run' : 'run';
  }
  if (s === 'biking' || s.includes('cycl') || s.includes('ride') || s.includes('bike') || s.includes('biking') || s.includes('spin')) {
    if (both.includes('indoor') || both.includes('spin') || both.includes('virtual') || both.includes('trainer')) return 'indoor_ride';
    return sub.includes('mountain') || s.includes('mountain') || s === 'mtb' ? 'mountain_bike' : 'ride';
  }
  if (s.includes('hik')) return 'hike';
  if (s.includes('walk')) return 'walk';
  if (s.includes('swim')) return both.includes('open_water') || both.includes('openwater') || both.includes('ocean') || both.includes('lake') ? 'open_water_swim' : 'swim';
  if (s.includes('row')) return 'row';
  if (s.includes('kayak') || s.includes('canoe') || s.includes('paddle') || s.includes('sup') || s.includes('surf')) return 'paddle';
  if (s.includes('snowboard')) return 'snowboard';
  if (s.includes('ski')) return both.includes('cross_country') || both.includes('nordic') || both.includes('xc') ? 'xc_ski' : 'ski';
  if (s.includes('skat')) return 'skate';
  if (s.includes('elliptical')) return 'elliptical';
  if (s.includes('stair')) return 'stair_climber';
  if (s.includes('yoga')) return 'yoga';
  if (s.includes('pilates')) return 'pilates';
  if (s.includes('stretch') || s.includes('mobility')) return 'stretch';
  if (s.includes('hiit') || s.includes('circuit') || s.includes('interval')) return 'hiit';
  if (s.includes('martial') || s.includes('boxing') || s.includes('karate') || s.includes('judo') || s.includes('taekwondo') || s.includes('kickbox')) return 'martial_arts';
  if (s.includes('danc')) return 'dance';
  if (s.includes('climb')) return 'climb';
  return 'other';
}
