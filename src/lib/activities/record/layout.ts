// ── The recorder's layout table (Program E, Oct 2026) — pure, TYPE imports only ──
// What each activity type SETS UP before Start, asks (≤ 3 of its own
// questions — Convention 45), RECORDS, and shows while live — one table,
// read by the set-up card, the live area and the Finish. A family default
// per recording kind here; Program F refines types one family at a time.
// `details.ts` pulls SportRegistry, so this file names question KEYS and
// never imports the questions: layout.test.ts pins every key against them.

import type { ActivityType } from '../catalog';
import type { TimerFormat } from './round-timer';

/** A control on the set-up card. */
export type SetupControl =
  | 'map' // a sport session's "Map my movement" (gps_optional only)
  | 'indoorTwin' // "Doing this indoors? Switch to {twin}" (catalog.ts INDOOR_TWIN)
  | 'timer' // arm a round timer before Start (duration and sport types only)
  | 'climbScale' // the grade scale (climb only — F3 moves it here from the log)
  | 'name';

/** What the card says will be recorded. */
export type Recorded = 'time' | 'map' | 'distance' | 'pace' | 'speed' | 'elevation' | 'descent' | 'steps' | 'rounds' | 'lengths' | 'climbs' | 'photos';

/** A panel of the live area, top → bottom. */
export type LivePanel = 'timer' | 'climbs' | 'lengths' | 'map' | 'stats' | 'details' | 'photos' | 'segments';

export type LiveStat = 'distance' | 'pace' | 'avgPace' | 'speed' | 'avgSpeed' | 'elevation' | 'descent' | 'steps';

export interface RecordLayout {
  setup: readonly SetupControl[];
  /** The type's own questions asked BEFORE Start (keys of DETAIL_FIELDS_BY_TYPE; choices and yes/no only; ≤ SHOWN_MAX). */
  setupFields: readonly string[];
  records: readonly Recorded[];
  live: readonly LivePanel[];
  liveStats: readonly LiveStat[];
  /** A big clock and the answers line, no stat grid, no Mark (yoga, pilates, stretch, dance). */
  calm?: true;
  /** The controls bar offers Mark (a segment) — not on a calm session. */
  mark?: false;
  /** Preselected on the set-up card's timer (hiit → Tabata, martial arts → Rounds). */
  timerDefault: TimerFormat | null;
}

const GPS_PACE: RecordLayout = {
  setup: ['name'],
  setupFields: [],
  records: ['time', 'map', 'distance', 'pace', 'elevation', 'photos'],
  live: ['map', 'stats', 'details', 'photos', 'segments'],
  liveStats: ['distance', 'pace', 'avgPace', 'elevation'],
  timerDefault: null,
};
const GPS_SPEED: RecordLayout = { ...GPS_PACE, records: ['time', 'map', 'distance', 'speed', 'elevation', 'photos'], liveStats: ['distance', 'speed', 'avgSpeed', 'elevation'] };
const FOOT: RecordLayout = { ...GPS_PACE, records: ['time', 'map', 'distance', 'pace', 'elevation', 'steps', 'photos'], liveStats: ['distance', 'pace', 'avgPace', 'elevation', 'steps'] };
const SNOW: RecordLayout = { ...GPS_SPEED, records: ['time', 'map', 'distance', 'speed', 'descent', 'photos'], liveStats: ['distance', 'speed', 'descent'] };
const TIMER: RecordLayout = {
  setup: ['name'],
  setupFields: [],
  records: ['time', 'distance', 'pace', 'photos'],
  live: ['stats', 'details', 'photos', 'segments'],
  liveStats: ['distance', 'pace', 'avgPace'],
  timerDefault: null,
};
const ROUNDS: RecordLayout = {
  setup: ['timer', 'name'],
  setupFields: [],
  records: ['time', 'rounds', 'photos'],
  // The clock ('stats') is on EVERY type — the live area shows nothing else of the time.
  live: ['timer', 'stats', 'details', 'photos', 'segments'],
  liveStats: [],
  timerDefault: null,
};
const CALM: RecordLayout = {
  setup: ['name'],
  setupFields: [],
  records: ['time', 'photos'],
  live: ['stats', 'timer', 'details', 'photos'],
  liveStats: [],
  calm: true,
  mark: false,
  timerDefault: null,
};

export const RECORD_LAYOUT_BY_TYPE: Readonly<Record<ActivityType, RecordLayout>> = {
  // outdoor — GPS
  run: { ...FOOT, setup: ['indoorTwin', 'name'] },
  trail_run: FOOT,
  walk: FOOT,
  hike: FOOT,
  ride: { ...GPS_SPEED, setup: ['indoorTwin', 'name'], setupFields: ['bike'] },
  mountain_bike: { ...GPS_SPEED, records: ['time', 'map', 'distance', 'speed', 'elevation', 'descent', 'photos'], liveStats: ['distance', 'speed', 'avgSpeed', 'elevation', 'descent'] },
  open_water_swim: { ...GPS_PACE, setup: ['indoorTwin', 'name'], setupFields: ['wetsuit'], records: ['time', 'map', 'distance', 'pace', 'photos'], liveStats: ['distance', 'pace', 'avgPace'] },
  paddle: { ...GPS_SPEED, setupFields: ['craft'] },
  ski: { ...SNOW, setupFields: ['terrain'] },
  xc_ski: { ...GPS_PACE, setupFields: ['technique'] },
  snowboard: { ...SNOW, setupFields: ['terrain'] },
  skate: { ...GPS_SPEED, setupFields: ['surface'] },
  // indoor — a timer, distance typed at finish
  // F5: the lengths counter under the clock; the live distance is lengths × the pool.
  swim: { ...TIMER, setupFields: ['pool', 'stroke'], records: ['time', 'lengths', 'distance', 'pace', 'photos'], live: ['stats', 'lengths', 'details', 'photos', 'segments'] },
  row: { ...TIMER, setupFields: ['setting'] },
  indoor_ride: { ...TIMER, setupFields: ['platform'], records: ['time', 'distance', 'speed', 'photos'], liveStats: ['distance', 'speed', 'avgSpeed'] },
  treadmill: { ...TIMER, records: ['time', 'distance', 'pace', 'steps', 'photos'], liveStats: ['distance', 'pace', 'avgPace', 'steps'] },
  elliptical: TIMER,
  stair_climber: { ...TIMER, setupFields: ['climbed_unit'] },
  // duration only
  yoga: { ...CALM, setupFields: ['style', 'heated', 'guided'] },
  pilates: { ...CALM, setupFields: ['apparatus', 'guided', 'focus'] },
  stretch: { ...CALM, setupFields: ['areas', 'purpose'] },
  dance: { ...CALM, setupFields: ['guided'] },
  hiit: { ...ROUNDS, setupFields: ['format'], timerDefault: 'tabata' },
  martial_arts: { ...ROUNDS, setupFields: ['discipline', 'session'], timerDefault: 'rounds' },
  other: ROUNDS,
  climb: {
    // F3: the scale is chosen on the set-up card (filtered by the style); the log leads the live area.
    setup: ['climbScale', 'name'],
    setupFields: ['setting', 'style'],
    records: ['time', 'climbs', 'photos'],
    live: ['climbs', 'stats', 'timer', 'details', 'photos'],
    liveStats: [],
    timerDefault: null,
  },
  // a sport's practice or game: a timer, a map only when turned on
  sport_session: {
    setup: ['map', 'timer', 'name'],
    setupFields: ['sport', 'session_kind'],
    records: ['time', 'map', 'distance', 'photos'],
    live: ['map', 'stats', 'timer', 'details', 'photos', 'segments'],
    liveStats: ['distance', 'speed', 'avgSpeed'],
    timerDefault: null,
  },
};

export function recordLayout(type: ActivityType): RecordLayout {
  return RECORD_LAYOUT_BY_TYPE[type];
}
