import type { OrgEvent } from '@/lib/calendar/org-events-server';
import type { PublicCompetitionStandings, PublicStandingsPayload } from '@/lib/competitions/public-standings';
import type { PublicGolfWeek } from '@/lib/competitions/golf-weeks';
import { FIXTURE_RULES, LEADERBOARD_RULES } from '@/lib/competitions/scoring';
import type { CourseStats } from '@/lib/golf/course-stats';
import type { MemberStats } from '@/lib/golf/member-stats';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import type {
  PublicAffiliation,
  PublicCourse,
  PublicDivision,
  PublicGolfRound,
  PublicLeaderBoard,
  PublicNewsItem,
  PublicOpenWindow,
  PublicStaffRow,
  PublicTeam,
  PublicVenue,
} from '@/lib/org-sites/public-data';
import type { CourseHole, GolfCourse } from '@/types/golf';
import { SAMPLE_MEDIA_URI_RE } from '@/lib/media/org-site-media';
import { WIDGETS, isContentWidgetKey, type SiteWidgetKey } from './catalog';
import type { ContentSource } from './config';
import type { SiteLayout, WidgetInstance } from './layout';

/**
 * Sample data for the EDITOR — Site Builder program 3, S1 (Sep 13 2026).
 *
 * Empty sections make a layout impossible to judge, so the editor can show
 * every widget as it will look once the club is active: realistic,
 * sport-appropriate content in modest volume (eight standings rows, three
 * posts, six sponsors, a full contact block — enough to judge spacing and
 * truncation, never the maximum). The house rule that fabricated content
 * never reaches a public surface or the database holds BY CONSTRUCTION:
 *
 *  • This module is pure and client-safe (no zod, no validate.ts, no
 *    emptiness.ts — the emptiness predicate is injected), like gallery.ts.
 *  • `applySample` returns a site CLONE and a separate sample bag; it never
 *    mutates its inputs and hands back the very same references when it is
 *    disabled or nothing is empty. The canvas applies it at its RENDER
 *    boundary only — history, the draft PUT, every `set_*` PATCH, the
 *    checklist and the publish gate keep the real site, data and layout.
 *  • A sampled instance renders over the WHOLE sample bag through a
 *    query-stripped clone (`sampleInstance`), so a standings tile bound to
 *    a real competition still shows the sample table — while a sibling
 *    tile with real rows keeps the real bag (per instance, never a merged
 *    clone that could shadow real data).
 *  • Sample media are inline base64 SVG data URIs. `orgMediaUrl` passes
 *    them through for RENDER; every WRITE path is a zod regex on the stored
 *    path (`ORG_MEDIA_PATH_RE` and friends), so a data URI cannot enter the
 *    database through any API.
 *  • Every family's strings carry `SAMPLE_SENTINEL`, the e2e absence check
 *    on the draft PUT and the published page.
 *
 * People appear in the MASKED shape the public site uses ("Jamie R."),
 * with no handle, so nothing links; organisations and sponsors are
 * fictional and never a real brand; dates are relative to `now`.
 */

export const SAMPLE_SENTINEL = 'Meadowvale';

export { SAMPLE_MEDIA_URI_RE };

type Family = 'golf' | 'team';
const familyOf = (sportKey: string | null | undefined): Family => (sportKey === 'golf' ? 'golf' : 'team');

const PEOPLE = ['Jamie R.', 'Priya K.', 'Marcus T.', 'Elena V.', 'Sam O.', 'Noor A.', 'Theo B.', 'Ava M.'] as const;
const TEAMS = ['Northgate Wolves', 'Riverside Comets', 'Harbour Hawks', 'Summit Storm'] as const;
const CLUB_TEAMS = [
  'Northgate Wolves',
  'Riverside Comets',
  'Harbour Hawks',
  'Summit Storm',
  'Lakeside Lynx',
  'Westbrook Rangers',
  'Oakfield United',
  'Pinecrest Blaze',
] as const;
const GOLF_COURSE = `${SAMPLE_SENTINEL} Golf Club`;
const ARENA = `${SAMPLE_SENTINEL} Arena`;

// ── Dates (relative to `now`, DST-free calendar arithmetic) ──────────────────
const DAY = 86_400_000;
const dayIso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY);
/** The next occurrence of a weekday (0 = Sunday … 6 = Saturday), at least tomorrow. */
function nextWeekday(now: Date, weekday: number): Date {
  const delta = ((weekday - now.getUTCDay() + 7) % 7) || 7;
  return addDays(now, delta);
}
const at = (d: Date, hourUtc: number): string => {
  const x = new Date(d.getTime());
  x.setUTCHours(hourUtc, 0, 0, 0);
  return x.toISOString();
};

// ── Sample media: inline SVG, base64 (btoa in the browser, Buffer in vitest) ──
function b64(s: string): string {
  if (typeof btoa === 'function') return btoa(s);
  return Buffer.from(s, 'utf8').toString('base64');
}
const svgUri = (svg: string): string => `data:image/svg+xml;base64,${b64(svg)}`;

/** A 96×96 rounded tile with two-letter initials — a sponsor logo. */
export function logoSvg(initials: string, hue: number): string {
  const text = initials.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'S';
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
      `<rect width="96" height="96" rx="16" fill="hsl(${hue} 55% 42%)"/>` +
      `<text x="48" y="58" text-anchor="middle" font-family="system-ui, sans-serif" font-size="34" font-weight="700" fill="#fff">${text}</text>` +
      `</svg>`
  );
}

/** A 1200×675 soft gradient with a faint sport glyph — a cover or photo. */
export function coverSvg(hue: number, family: Family): string {
  const glyph =
    family === 'golf'
      ? `<circle cx="600" cy="360" r="70" fill="#fff" fill-opacity="0.35"/><rect x="596" y="150" width="8" height="210" fill="#fff" fill-opacity="0.35"/><path d="M604 150 L720 190 L604 230 Z" fill="#fff" fill-opacity="0.35"/>`
      : `<circle cx="600" cy="337" r="110" fill="none" stroke="#fff" stroke-opacity="0.4" stroke-width="12"/><path d="M600 227 L600 447 M490 337 L710 337" stroke="#fff" stroke-opacity="0.4" stroke-width="12"/>`;
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 50% 48%)"/><stop offset="1" stop-color="hsl(${(hue + 40) % 360} 45% 30%)"/></linearGradient></defs>` +
      `<rect width="1200" height="675" fill="url(#g)"/>${glyph}</svg>`
  );
}

// ── Per-sport vocabulary ─────────────────────────────────────────────────────
function facility(sportKey: string | null): { kind: string; names: string[] } {
  switch (sportKey) {
    case 'ice_hockey':
      return { kind: 'rink', names: ['Rink 1', 'Rink 2'] };
    case 'basketball':
    case 'volleyball':
      return { kind: 'court', names: ['Court 1', 'Court 2'] };
    case 'baseball':
      return { kind: 'diamond', names: ['Diamond A', 'Diamond B'] };
    default:
      return { kind: 'field', names: ['Field A', 'Field B'] };
  }
}
function statLabels(sportKey: string | null): [string, string] {
  switch (sportKey) {
    case 'basketball':
      return ['Points', 'Rebounds'];
    case 'volleyball':
      return ['Kills', 'Aces'];
    case 'baseball':
      return ['Hits', 'RBIs'];
    case 'ice_hockey':
    case 'soccer':
      return ['Goals', 'Assists'];
    default:
      return ['Points', 'Assists'];
  }
}
const fixtureRule = (sportKey: string | null) => (sportKey === 'ice_hockey' ? FIXTURE_RULES.points_2_1_0 : FIXTURE_RULES.points_3_1_0);

// ── The data bag ─────────────────────────────────────────────────────────────
function golfWeek(now: Date): PublicGolfWeek {
  const monday = addDays(now, -((now.getUTCDay() + 6) % 7));
  const results = [
    { entrant_name: PEOPLE[0], gross: 78, net: 71, holes: 18, tee: 'white', status: 'final' as const, disputed: false, points: 100 },
    { entrant_name: PEOPLE[1], gross: 82, net: 72, holes: 18, tee: 'white', status: 'final' as const, disputed: false, points: 90 },
    { entrant_name: PEOPLE[2], gross: 85, net: 74, holes: 18, tee: 'blue', status: 'final' as const, disputed: false, points: 82 },
    { entrant_name: PEOPLE[3], gross: 80, net: 75, holes: 18, tee: 'white', status: 'posted' as const, disputed: false },
    { entrant_name: PEOPLE[4], gross: 91, net: 77, holes: 18, tee: 'white', status: 'posted' as const, disputed: false },
    { entrant_name: PEOPLE[5], gross: 88, net: 78, holes: 18, tee: 'red', status: 'posted' as const, disputed: false },
  ];
  return {
    id: 'sample:week',
    round: 'Week 7',
    holes: 18,
    playFrom: dayIso(monday),
    playTo: dayIso(addDays(monday, 6)),
    courseName: GOLF_COURSE,
    status: 'open',
    state: 'open',
    participants: 12,
    posted: results.length,
    results,
  };
}

function golfStandings(orgName: string, now: Date): PublicStandingsPayload {
  const year = now.getUTCFullYear();
  const points = [412, 388, 371, 355, 340, 322, 309, 296];
  const rounds = [8, 8, 7, 8, 6, 7, 7, 6];
  const wins = [3, 2, 1, 1, 0, 0, 0, 0];
  const gross = [79.4, 81.2, 84.6, 82.9, 88.1, 86.3, 90.2, 87.8];
  const competition: PublicCompetitionStandings = {
    id: 'sample:competition',
    name: `${SAMPLE_SENTINEL} Points Race`,
    season_label: `${year} Season`,
    format: 'golf_league',
    status: 'active',
    columns: LEADERBOARD_RULES.golf_points.columns,
    rows: PEOPLE.map((name, i) => ({
      rank: i + 1,
      entrant_name: name,
      played: rounds[i],
      points: points[i],
      stats: { played: rounds[i], points: points[i], win: wins[i], gross: gross[i] },
    })),
    disputedCount: 0,
    direction: 'desc',
    entrant_type: 'athlete',
    sport_key: 'golf',
    golf: { pick: 'first', today: dayIso(now), currentWeekId: 'sample:week', weeks: [golfWeek(now)] },
  };
  return { orgName, competitions: [competition] };
}

function teamStandings(orgName: string, sportKey: string | null, now: Date): PublicStandingsPayload {
  const rule = fixtureRule(sportKey);
  const year = now.getUTCFullYear();
  const record: [number, number, number, number, number][] = [
    // w, l, t, gf, ga — 10 games each
    [8, 1, 1, 41, 18],
    [7, 2, 1, 36, 21],
    [6, 3, 1, 33, 25],
    [5, 4, 1, 29, 27],
    [4, 5, 1, 24, 28],
    [3, 6, 1, 22, 31],
    [2, 7, 1, 19, 35],
    [1, 8, 1, 14, 40],
  ];
  const competition: PublicCompetitionStandings = {
    id: 'sample:competition',
    name: `${SAMPLE_SENTINEL} Fall League`,
    season_label: `${year} Fall`,
    format: 'fixtures',
    status: 'active',
    columns: rule.columns,
    rows: record.map(([w, l, t, gf, ga], i) => {
      const points = w * rule.win + t * rule.tie + l * rule.loss;
      return {
        rank: i + 1,
        entrant_name: CLUB_TEAMS[i],
        played: w + l + t,
        points,
        stats: { played: w + l + t, w, l, t, gf, ga, diff: gf - ga, points },
      };
    }),
    disputedCount: 0,
    direction: 'desc',
    entrant_type: 'team',
    sport_key: sportKey ?? 'soccer',
  };
  return { orgName, competitions: [competition] };
}

function events(family: Family, sportKey: string | null, now: Date): OrgEvent[] {
  const sat = nextWeekday(now, 6);
  const base = { description: null, all_day: false, timezone: null, venue_id: null, facility_id: null, ends_at: null };
  if (family === 'golf') {
    return [
      { ...base, id: 'sample:event-1', title: 'Season scramble', location: GOLF_COURSE, starts_at: at(sat, 13), category: 'competition' },
      { ...base, id: 'sample:event-2', title: 'Tee-time night', location: GOLF_COURSE, starts_at: at(addDays(sat, 4), 22), category: 'social' },
      { ...base, id: 'sample:event-3', title: 'Course work party', location: `${GOLF_COURSE} · maintenance shed`, starts_at: at(addDays(sat, 7), 12), category: 'volunteer' },
      { ...base, id: 'sample:event-4', title: 'Awards evening', location: `${SAMPLE_SENTINEL} Clubhouse`, starts_at: at(addDays(sat, 21), 23), category: 'social' },
    ];
  }
  const f = facility(sportKey);
  const where = (n: number) => `${f.names[n % f.names.length]}, ${ARENA}`;
  return [
    { ...base, id: 'sample:event-1', title: `${TEAMS[0]} vs ${TEAMS[1]}`, location: where(0), starts_at: at(sat, 14), category: 'game' },
    { ...base, id: 'sample:event-2', title: `${TEAMS[2]} vs ${TEAMS[3]}`, location: where(1), starts_at: at(sat, 16), category: 'game' },
    { ...base, id: 'sample:event-3', title: 'U13 practice', location: where(0), starts_at: at(addDays(sat, 3), 22), category: 'practice' },
    { ...base, id: 'sample:event-4', title: `${TEAMS[1]} vs ${TEAMS[2]}`, location: where(1), starts_at: at(addDays(sat, 7), 14), category: 'game' },
  ];
}

function leaders(family: Family, sportKey: string | null, now: Date): PublicLeaderBoard[] {
  if (family === 'golf') {
    const note = `Week 6 · ${dayIso(addDays(now, -7))}`;
    return [
      {
        competitionId: 'sample:competition',
        competitionName: `${SAMPLE_SENTINEL} Points Race`,
        sportKey: 'golf',
        unsupported: false,
        stats: [
          {
            label: 'Lowest net',
            valueLabel: 'Net',
            rows: [69, 71, 72, 74, 75].map((value, i) => ({ name: PEOPLE[i], teamName: null, value, note })),
          },
        ],
      },
    ];
  }
  const [a, b] = statLabels(sportKey);
  return [
    {
      competitionId: 'sample:competition',
      competitionName: `${SAMPLE_SENTINEL} Fall League`,
      sportKey: sportKey ?? 'soccer',
      unsupported: false,
      stats: [
        { label: a, rows: [14, 12, 11, 9, 8].map((value, i) => ({ name: PEOPLE[i], teamName: TEAMS[i % 4], value })) },
        { label: b, rows: [11, 9, 9, 7, 6].map((value, i) => ({ name: PEOPLE[(i + 3) % 8], teamName: TEAMS[(i + 1) % 4], value })) },
      ],
    },
  ];
}

function golfCourse(): GolfCourse {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 3, 4, 5, 4, 4, 3, 4, 5]; // 72
  const holes: CourseHole[] = pars.map((par, i) => ({
    number: i + 1,
    par,
    yardage: { white: par === 3 ? 165 + i * 3 : par === 4 ? 380 + i * 4 : 510 + i * 3, blue: par === 3 ? 180 + i * 3 : par === 4 ? 405 + i * 4 : 540 + i * 3 },
    handicap: ((i * 7) % 18) + 1,
  }));
  return {
    id: 'sample:course',
    name: GOLF_COURSE,
    city: SAMPLE_SENTINEL,
    holes,
    totalPar: 72,
    holesCount: 18,
    courseRating: { white: 71.2, blue: 73.4 },
    slopeRating: { white: 128, blue: 134 },
  };
}

function courseStrip(now: Date): CourseStats {
  const d = (n: number) => dayIso(addDays(now, -n));
  return {
    roundsPosted: 42,
    byTee: [
      { tee: 'white', holes: 18, rounds: 30, avgGross: 88.4, best: { gross: 74, date: d(23), name: PEOPLE[0] } },
      { tee: 'blue', holes: 18, rounds: 12, avgGross: 91.1, best: { gross: 77, date: d(40), name: PEOPLE[2] } },
    ],
    courseRecord: [{ holes: 18, tee: 'white', gross: 74, date: d(23), name: PEOPLE[0] }],
    hardestHoles: [
      { hole: 7, par: 3, avgOverPar: 1.3, tracked: 30 },
      { hole: 13, par: 5, avgOverPar: 1.1, tracked: 28 },
      { hole: 4, par: 5, avgOverPar: 0.9, tracked: 31 },
    ],
    recentRounds: [
      { name: PEOPLE[3], date: d(1), gross: 84, tee: 'white', holes: 18 },
      { name: PEOPLE[1], date: d(2), gross: 79, tee: 'white', holes: 18 },
      { name: PEOPLE[6], date: d(4), gross: 41, tee: 'red', holes: 9 },
    ],
  };
}

function memberStats(now: Date): MemberStats {
  const d = (n: number) => dayIso(addDays(now, -n));
  const handicaps = ['4.2', '8.9', '12.4', '15.1', '18.7', '+1.2', '22.0', '9.6'];
  const rounds = [31, 24, 19, 17, 15, 28, 11, 22];
  const avg = [80.1, 84.7, 88.2, 91.5, 94.8, 75.3, 97.0, 85.9];
  return {
    memberCount: 34,
    roundsPosted: 118,
    members: PEOPLE.map((name, i) => ({
      profileId: `sample:member-${i + 1}`,
      name,
      handle: null,
      handicap: handicaps[i],
      rounds: rounds[i],
      roundsThisSeason: Math.max(3, Math.round(rounds[i] / 2)),
      avg18: avg[i],
      avg9: null,
      best18: { gross: Math.round(avg[i] - 6), date: d(9 + i * 5) },
      best9: null,
    })),
    boards: [
      { label: 'Most rounds', valueLabel: 'Rounds', rows: [31, 28, 24, 22, 19].map((value, i) => ({ name: PEOPLE[[0, 5, 1, 7, 2][i]], value })) },
      { label: 'Lowest gross', valueLabel: 'Gross', rows: [69, 74, 76, 78, 79].map((value, i) => ({ name: PEOPLE[[5, 0, 7, 1, 2][i]], value })) },
    ],
    recent: [
      { name: PEOPLE[3], date: d(1), gross: 84, holes: 18, courseName: GOLF_COURSE },
      { name: PEOPLE[1], date: d(2), gross: 79, holes: 18, courseName: GOLF_COURSE },
      { name: PEOPLE[6], date: d(4), gross: 41, holes: 9, courseName: GOLF_COURSE },
    ],
  };
}

function news(family: Family, now: Date): PublicNewsItem[] {
  const cover = (n: number, hue: number) => ({ path: coverSvg(hue, family), alt: `Sample cover ${n}`, width: 1200, height: 675 });
  const golf = family === 'golf';
  return [
    {
      slug: 'sample-season-opener',
      title: golf ? 'Season opener: scramble this Saturday' : 'Season opener this Saturday',
      publishedAt: addDays(now, -2).toISOString(),
      excerpt: golf
        ? `Tee times run from 1 pm at ${GOLF_COURSE}. Sign up at the pro shop by Thursday.`
        : `Opening day at ${ARENA} — four games, two rinks, and the concession is open.`,
      cover: cover(1, 152),
    },
    {
      slug: 'sample-new-sponsor',
      title: `${SAMPLE_SENTINEL} Hardware joins as a sponsor`,
      publishedAt: addDays(now, -9).toISOString(),
      excerpt: 'A local partner for the season — thank you for keeping the lights on.',
      cover: cover(2, 24),
    },
    {
      slug: 'sample-registration-open',
      title: 'Registration is open',
      publishedAt: addDays(now, -16).toISOString(),
      excerpt: golf ? 'Spring points league spots are limited to 24 players.' : 'U11 and U13 divisions have a few spots left.',
      cover: cover(3, 208),
    },
  ];
}

/** The whole sample bag for a sport family. Every key filled — a widget
 *  merges only the keys it reads (`WIDGETS[key].data`). */
export function sampleHomeData(sportKey: string | null | undefined, side: 'league' | 'club', now: Date = new Date()): SiteHomeData {
  const family = familyOf(sportKey);
  const sport = sportKey ?? null;
  const year = now.getUTCFullYear();
  const orgName = `${SAMPLE_SENTINEL} ${side === 'club' ? 'Club' : 'League'}`;
  const f = facility(sport);
  const teams: PublicTeam[] = TEAMS.map((name, i) => ({ id: `sample:team-${i + 1}`, name, divisionLabels: [i < 2 ? `U13 A · ${year} Fall` : `U11 A · ${year} Fall`] }));
  const staff: PublicStaffRow[] = [
    { name: PEOPLE[0], role: 'owner' },
    { name: PEOPLE[1], role: 'manager' },
    { name: PEOPLE[2], role: 'manager' },
  ];
  const venues: PublicVenue[] =
    family === 'golf'
      ? [{ id: 'sample:venue', name: GOLF_COURSE, city: SAMPLE_SENTINEL, region: null, country: null, facilities: [{ id: 'sample:fac-1', name: 'Championship 18', kind: 'course' }, { id: 'sample:fac-2', name: 'Practice range', kind: 'range' }] }]
      : [{ id: 'sample:venue', name: ARENA, city: SAMPLE_SENTINEL, region: null, country: null, facilities: f.names.map((name, i) => ({ id: `sample:fac-${i + 1}`, name, kind: f.kind })) }];
  const affiliations: PublicAffiliation[] = [
    { name: 'Northern Regional Association', affiliationType: 'sanctioning body', city: null, region: null, direction: 'up' },
    { name: `${SAMPLE_SENTINEL} Juniors`, affiliationType: 'club', city: SAMPLE_SENTINEL, region: null, direction: 'down' },
  ];
  const openWindows: PublicOpenWindow[] = [
    {
      seasonLabel: `${year}–${year + 1} Season`,
      offeringName: family === 'golf' ? 'Spring Points League' : 'U13',
      opensAt: addDays(now, -7).toISOString(),
      closesAt: addDays(now, 21).toISOString(),
    },
  ];
  const divisions: PublicDivision[] = [
    { seasonLabel: `${year} Fall`, divisionName: 'U11', ageBand: 'U11', tier: 'A', teams: teams.slice(2).map(t => ({ id: t.id, name: t.name })) },
    { seasonLabel: `${year} Fall`, divisionName: 'U13', ageBand: 'U13', tier: 'A', teams: teams.slice(0, 2).map(t => ({ id: t.id, name: t.name })) },
  ];
  const week = golfWeek(now);
  const golfRounds: PublicGolfRound[] =
    family === 'golf'
      ? [{ id: 'sample:round', competitionId: 'sample:competition', competitionName: `${SAMPLE_SENTINEL} Points Race`, round: week.round, holes: 18, playFrom: week.playFrom, playTo: week.playTo, courseName: GOLF_COURSE, state: 'open', eventId: null }]
      : [];
  const courses: PublicCourse[] = family === 'golf' ? [{ venueName: GOLF_COURSE, course: golfCourse() }] : [];
  return {
    standings: family === 'golf' ? golfStandings(orgName, now) : teamStandings(orgName, sport, now),
    events: events(family, sport, now),
    teams,
    staff,
    venues,
    affiliations,
    openWindows,
    courses,
    divisions,
    leaders: leaders(family, sport, now),
    clubGolfBoards: [],
    courseStrip: family === 'golf' ? courseStrip(now) : null,
    golfRounds,
    news: news(family, now),
    memberStats: family === 'golf' ? memberStats(now) : null,
  };
}

// ── Content (config-backed widgets) ──────────────────────────────────────────
export const SAMPLE_SPONSORS = [
  { name: `${SAMPLE_SENTINEL} Hardware`, tier: 'platinum', hue: 24 },
  { name: 'Riverside Dental', tier: 'gold', hue: 200 },
  { name: 'Northgate Physio', tier: 'gold', hue: 152 },
  { name: 'Harbour Coffee Roasters', tier: 'silver', hue: 30 },
  { name: 'Summit Sports Supply', tier: 'bronze', hue: 260 },
  { name: 'Lakeside Insurance', tier: 'partner', hue: 330 },
] as const;

/** The content a config-backed widget renders when it has none of its own.
 *  Keys mirror the stored shapes the render parsers accept (`parseSponsors`,
 *  `parseDocuments`, `parseContact`, `parseHeroConfig`, `parsePageBody`). */
export function sampleContentFor(key: SiteWidgetKey, ctx: { orgName: string; sportKey?: string | null }): Record<string, unknown> {
  const family = familyOf(ctx.sportKey);
  switch (key) {
    case 'sponsors':
      return {
        sponsors: SAMPLE_SPONSORS.map(s => ({
          name: s.name,
          tier: s.tier,
          logoPath: logoSvg(s.name.split(' ').map(w => w[0]).join(''), s.hue),
        })),
      };
    case 'documents':
      return {
        documents: [
          { title: 'Code of conduct', url: 'https://www.example.com/meadowvale/code-of-conduct.pdf' },
          { title: `${SAMPLE_SENTINEL} season handbook`, url: 'https://www.example.com/meadowvale/handbook.pdf' },
        ],
      };
    case 'contact':
      return {
        email: 'hello@meadowvale.example',
        phone: '(555) 010-2468',
        website: 'https://www.example.com',
        address: [`12 ${SAMPLE_SENTINEL} Road`, SAMPLE_SENTINEL],
        hours: family === 'golf' ? 'Pro shop 7 am – dusk, seven days' : 'Office hours Mon–Fri, 9 am – 5 pm',
        social: { instagram: 'https://www.instagram.com/meadowvale' },
      };
    case 'hero':
      return {
        headline: `Welcome to ${ctx.orgName}`,
        tagline:
          family === 'golf'
            ? `Weekly play, friendly competition and a home course at ${SAMPLE_SENTINEL}.`
            : `Teams, schedules and standings for ${SAMPLE_SENTINEL} — all in one place.`,
        imagePath: coverSvg(family === 'golf' ? 120 : 215, family),
        imageAlt: 'Sample photo',
      };
    case 'text':
      return {
        blocks: [
          {
            type: 'paragraph',
            text: `${ctx.orgName} plays out of ${SAMPLE_SENTINEL}. This is sample text: replace it with a few lines about who you are, when you play and how to get involved.`,
          },
        ],
      };
    case 'image':
      return { path: coverSvg(family === 'golf' ? 95 : 190, family), alt: 'Sample photo', width: 1200, height: 675 };
    default:
      // embed (the canvas draws its own placeholder frame — never a
      // third-party iframe from sample data), gallery, the forms and
      // every data-backed widget: no content sample.
      return {};
  }
}

// ── The overlay ──────────────────────────────────────────────────────────────
export interface SampleSite extends ContentSource {
  orgName: string;
  sportKey: string | null;
  side: 'league' | 'club';
}

export interface SampleView<S extends SampleSite> {
  /** The site to render — a clone with sample content spliced in, or the
   *  input itself when nothing was sampled. */
  site: S;
  /** Which instances render sample content (their ids). */
  sampled: ReadonlySet<string>;
  /** The bag a SAMPLED instance renders over (the real bag for the rest). */
  sampleData: SiteHomeData;
}

export type EmptyPredicate<S extends SampleSite> = (w: WidgetInstance, data: SiteHomeData, site: S) => boolean;

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Widgets whose "content" is a per-site singleton the site clone carries. */
const SITE_CONTENT_KEYS = new Set<SiteWidgetKey>(['sponsors', 'documents', 'contact', 'hero']);

function heroIsBlank(site: SampleSite): boolean {
  const h = asRecord(site.hero_config);
  const headline = typeof h.headline === 'string' && h.headline.trim().length > 0;
  const image = typeof h.imagePath === 'string' && h.imagePath.length > 0;
  return !headline && !image;
}

/**
 * Decide which instances render sample content and build the clone they
 * render over. Pure; never mutates; disabled (or nothing empty) → the
 * SAME site reference and an empty set. `sampleData` is always the full
 * sample bag so a caller can hand it to a sampled instance.
 */
export function applySample<S extends SampleSite>(
  site: S,
  data: SiteHomeData,
  layout: SiteLayout,
  enabled: boolean,
  isEmpty: EmptyPredicate<S>,
  now: Date = new Date()
): SampleView<S> {
  const sampleData = sampleHomeData(site.sportKey, site.side, now);
  const sampled = new Set<string>();
  if (!enabled) return { site, sampled, sampleData };
  const contentKeys = new Set<SiteWidgetKey>();
  for (const w of layout.widgets) {
    const key = w.key as SiteWidgetKey;
    if (key === 'contact_form' || key === 'interest_form' || key === 'gallery') continue;
    if (key === 'hero') {
      if (heroIsBlank(site)) {
        sampled.add(w.id);
        contentKeys.add('hero');
      }
      continue;
    }
    if (!isEmpty(w, data, site)) continue;
    sampled.add(w.id);
    if (SITE_CONTENT_KEYS.has(key)) contentKeys.add(key);
  }
  if (sampled.size === 0) return { site, sampled, sampleData };
  if (contentKeys.size === 0) return { site, sampled, sampleData };
  const ctx = { orgName: site.orgName, sportKey: site.sportKey };
  let modules = site.modules;
  const touched = [...contentKeys].filter(k => k !== 'hero' && k !== 'contact');
  if (touched.length > 0) {
    modules = site.modules.map(m => (contentKeys.has(m.module_key as SiteWidgetKey) && m.module_key !== 'contact' ? { ...m, config: { ...asRecord(m.config), ...sampleContentFor(m.module_key as SiteWidgetKey, ctx) } } : m));
    for (const k of touched) {
      // A row the site lacks (a page instance of a module the org never
      // enabled): the clone carries one so `effectiveConfig` finds content.
      if (!modules.some(m => m.module_key === k)) {
        const row = { module_key: k, enabled: true, sort_order: modules.length, config: sampleContentFor(k, ctx) } as unknown as S['modules'][number];
        modules = [...modules, row];
      }
    }
  }
  const clone: S = {
    ...site,
    modules,
    ...(contentKeys.has('contact') ? { contact_config: { ...asRecord(site.contact_config), ...sampleContentFor('contact', ctx) } } : {}),
    ...(contentKeys.has('hero') ? { hero_config: { ...asRecord(site.hero_config), ...sampleContentFor('hero', ctx) } } : {}),
  };
  return { site: clone, sampled, sampleData };
}

/** The render-only clone of a sampled instance: the content widgets' sample
 *  config on top, and NO query (so the sample bag's one competition / venue
 *  is what it shows). An unsampled instance comes back untouched. */
export function sampleInstance(w: WidgetInstance, sampled: ReadonlySet<string>, ctx: { orgName: string; sportKey?: string | null }): WidgetInstance {
  if (!sampled.has(w.id)) return w;
  const config: Record<string, unknown> = { ...asRecord(w.config) };
  delete config.query;
  const key = w.key as SiteWidgetKey;
  const content = isContentWidgetKey(key) ? sampleContentFor(key, ctx) : {};
  return { ...w, config: { ...config, ...content } };
}

/** The data keys a widget reads — exported for tests (a sampled widget's
 *  keys must all be non-empty in the sample bag). */
export const sampleKeysFor = (key: SiteWidgetKey) => WIDGETS[key].data;
