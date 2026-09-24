/**
 * Competitions (151) — the PURE validation half (node-only vitest; no
 * framework or Supabase imports; the structure/validate.ts pattern).
 *
 * Phase-2 v1 gates (Tom, Aug 31): only fixture+team and leaderboard+
 * athlete are creatable — bracket/meet/ad_hoc_team are front-loaded in
 * the DB CHECKs but rejected HERE until their rounds arrive. sport_key
 * membership in FEATURE_SPORTS is checked in the ROUTE (the 113
 * convention — this file stays registry-free), as are all cross-row
 * rules (season.org == competition.org; division belongs to the season;
 * entered team ownership; roster-only athlete entrants).
 *
 * scoring_rule is an app-side registry key (competitions/scoring.ts,
 * R3); NULL means the sport adapter's default. Validated here only for
 * shape — the scoring registry gates unknown keys at compute time.
 */

import { z } from 'zod';
import { boundedText, optionalText, uuid } from '@/lib/validation';
import { COMPETITION_FORMATS, ENTRANT_KINDS, type CompetitionFormat } from '@/lib/sports/competition-profiles';

export { isMissingTableError } from '@/lib/orgs/validate';
export { OrgKindSchema } from '@/lib/structure/validate';
import { OrgKindSchema } from '@/lib/structure/validate';

/**
 * The format vocabulary is the DB's four (track 2 PR 1); what is CREATABLE
 * is `FORMATS_LIVE`, widened per round (PR 3: bracket · PR 7: meet) — the
 * DB CHECKs never change. The entrant kind is DERIVED from the sport's
 * competition profile (`defaultEntrantFor`) unless the organizer names one
 * the profile allows (`formatEntrantRefusal`, checked in the server lib).
 */
export const COMPETITION_FORMATS_V1 = ['fixture', 'leaderboard'] as const;
export const FORMATS_LIVE: readonly CompetitionFormat[] = ['fixture', 'leaderboard', 'bracket', 'meet'];
export const isFormatLive = (format: string): format is CompetitionFormat => (FORMATS_LIVE as readonly string[]).includes(format);

/** Phase 6c G1: a bare calendar date (golf_rounds.date is a DATE). */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const CompetitionCreateSchema = z
  .object({
    side: OrgKindSchema,
    orgId: uuid,
    seasonId: uuid,
    divisionId: uuid.optional(),
    sportKey: boundedText(40),
    name: boundedText(80),
    format: z.enum(COMPETITION_FORMATS).refine(isFormatLive, { message: 'That competition format is not available yet' }),
    // Track 2: the organizer may name the entrant kind when the sport's profile offers more than one.
    entrantType: z.enum(ENTRANT_KINDS).optional(),
    scoringRule: optionalText(40),
    visibility: z.enum(['public', 'private']).default('private'),
    // Phase 6c G1: shape-blind competition config; the first key is the
    // golf league's counting-round choice.
    config: z
      .object({
        golf: z
          .object({
            pick: z.enum(['first', 'best']),
            // Phase 7 C6 (golf_points): the strokes rounds are ranked on and
            // the points table.
            score: z.enum(['gross', 'net']).optional(),
            points: z.enum(['pga', 'linear']).optional(),
            // Onboarding v2 R4: a club is NOT a course — rounds at ANY
            // catalog course count when set (contests carry no venue).
            anyCourse: z.boolean().optional(),
          })
          .optional(),
        // Track 2 PR 8: the meet's points per place (1st first, non-increasing, ≤ 16); absent = 10-8-6-5-4-3-2-1.
        meet: z
          .object({
            points: z
              .array(z.number().finite().min(0))
              .min(1)
              .max(16)
              .refine(pts => pts.every((v, i) => i === 0 || v <= pts[i - 1]), { message: 'Points must not increase down the places' }),
          })
          .optional(),
      })
      .optional(),
  });
export type CompetitionCreateInput = z.infer<typeof CompetitionCreateSchema>;

/** Lifecycle + visibility edits. Name edits deliberately absent v1 —
 *  the org+season+name unique is the duplicate authority. */
export const CompetitionPatchSchema = z
  .object({
    id: uuid,
    status: z.enum(['draft', 'active', 'completed', 'archived']).optional(),
    visibility: z.enum(['public', 'private']).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.status === undefined && val.visibility === undefined) {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'Nothing to change' });
    }
  });
export type CompetitionPatchInput = z.infer<typeof CompetitionPatchSchema>;

/** Contest creation (R2). Fixture contests carry BOTH sides at birth
 *  (home/away entry ids); leaderboard contests (R5) are born bare and
 *  gain participants separately. Entry membership in the competition is
 *  the server lib's job. */
/** Track 2 PR 3: the FULL seeded order (the flights PUT precedent) — every id an approved entry, once. */
export const SeedsPutSchema = z.object({
  competitionId: uuid,
  entryIds: z.array(uuid).min(2).max(64),
});
export type SeedsPutInput = z.infer<typeof SeedsPutSchema>;

/** Track 2 PR 3: generate the bracket from the seeded order — dry-run by default (the golf-season two-step). */
export const BracketGenerateSchema = z.object({
  competitionId: uuid,
  dryRun: z.boolean().default(true),
});
export type BracketGenerateInput = z.infer<typeof BracketGenerateSchema>;

export const ContestCreateSchema = z
  .object({
    competitionId: uuid,
    scheduledAt: z.string().datetime({ offset: true }).optional(),
    round: optionalText(40),
    venueId: uuid.optional(),
    facilityId: uuid.optional(),
    homeEntryId: uuid.optional(),
    awayEntryId: uuid.optional(),
    // Phase 6c G1: a golf league round declares its hole count and its
    // PLAY WINDOW (members play any day of it). Dates, like golf_rounds.date.
    holes: z.union([z.literal(9), z.literal(18)]).optional(),
    playFrom: z.string().regex(ISO_DATE_RE, 'YYYY-MM-DD').optional(),
    playTo: z.string().regex(ISO_DATE_RE, 'YYYY-MM-DD').optional(),
  })
  .superRefine((val, ctx) => {
    if (val.facilityId && !val.venueId) {
      ctx.addIssue({ code: 'custom', path: ['facilityId'], message: 'A facility needs its venue' });
    }
    if (val.playFrom && val.playTo && val.playTo < val.playFrom) {
      ctx.addIssue({ code: 'custom', path: ['playTo'], message: 'The window ends before it starts' });
    }
    if ((val.playFrom && !val.playTo) || (val.playTo && !val.playFrom)) {
      ctx.addIssue({ code: 'custom', path: ['playTo'], message: 'A play window needs both dates' });
    }
    if ((val.homeEntryId || val.awayEntryId) && val.homeEntryId === val.awayEntryId) {
      ctx.addIssue({ code: 'custom', path: ['awayEntryId'], message: 'Home and away must differ' });
    }
  });
export type ContestCreateInput = z.infer<typeof ContestCreateSchema>;

/** Phase 6d W3: a golf league's whole season in one declaration — N
 *  weekly rounds from a start date, each a windowDays-long play window.
 *  venueId names ONE course; absent (Onboarding v2 R4) the league must be
 *  any-course (config.golf.anyCourse) and members' rounds count wherever
 *  they were played. Dry-run by default. */
export const GolfSeasonGenerateSchema = z.object({
  competitionId: uuid,
  startDate: z.string().regex(ISO_DATE_RE, 'YYYY-MM-DD'),
  weeks: z.number().int().min(1).max(52),
  windowDays: z.number().int().min(1).max(14),
  holes: z.union([z.literal(9), z.literal(18)]),
  // R4: null/absent ⇒ any course (the competition's config.golf.anyCourse must be set).
  venueId: uuid.nullable().optional(),
  labelPattern: optionalText(34),
  dryRun: z.boolean().default(true),
  // S4: the generated rounds land on members' calendars as all-day windows.
  publishToCalendar: z.boolean().default(true),
  timezone: boundedText(64).default('UTC'),
});
export type GolfSeasonGenerateInput = z.infer<typeof GolfSeasonGenerateSchema>;

export const ContestPatchSchema = z
  .object({
    id: uuid,
    status: z.enum(['scheduled', 'in_progress', 'completed', 'canceled', 'postponed']).optional(),
    scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
    round: optionalText(40).nullable().optional(),
    venueId: uuid.nullable().optional(),
    facilityId: uuid.nullable().optional(),
    holes: z.union([z.literal(9), z.literal(18)]).nullable().optional(),
    playFrom: z.string().regex(ISO_DATE_RE, 'YYYY-MM-DD').nullable().optional(),
    playTo: z.string().regex(ISO_DATE_RE, 'YYYY-MM-DD').nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.playFrom && val.playTo && val.playTo < val.playFrom) {
      ctx.addIssue({ code: 'custom', path: ['playTo'], message: 'The window ends before it starts' });
    }
    const changes = [val.status, val.scheduledAt, val.round, val.venueId, val.facilityId, val.holes, val.playFrom, val.playTo];
    if (changes.every(v => v === undefined)) {
      ctx.addIssue({ code: 'custom', path: ['status'], message: 'Nothing to change' });
    }
  });
export type ContestPatchInput = z.infer<typeof ContestPatchSchema>;

/** Publish-to-calendar (R2). timezone rides from the publishing manager's
 *  browser (events.timezone is NOT NULL); UTC when absent — the calendar
 *  grid renders viewer-local regardless. */
export const ContestPublishSchema = z.object({
  contestId: uuid,
  timezone: boundedText(64).default('UTC'),
});
export type ContestPublishInput = z.infer<typeof ContestPublishSchema>;

/** S4: publish every unpublished scheduled/windowed round of a competition. */
export const ContestPublishSeasonSchema = z.object({
  competitionId: uuid,
  timezone: boundedText(64).default('UTC'),
});
export type ContestPublishSeasonInput = z.infer<typeof ContestPublishSeasonSchema>;

/** Result entry (R2): one batch per contest — a fixture's "3 – 2" is one
 *  submit. payload is the adapter-typed blob (stats_data precedent);
 *  score is the adapter-derived sort key. Provenance is stamped
 *  SERVER-side, never accepted from the client. */
export const ResultUpsertSchema = z.object({
  contestId: uuid,
  results: z
    .array(
      z.object({
        participantId: uuid,
        // Sort key, adapter-derived. ±1e6 comfortably covers every sport's
        // scale (strokes, goals, seconds-as-ms) while rejecting nonsense.
        score: z.number().finite().min(-1_000_000).max(1_000_000),
        payload: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1)
    .max(50),
});
export type ResultUpsertInput = z.infer<typeof ResultUpsertSchema>;

/** Per-athlete stat lines for one contest (phase 4 R1): one batch per
 *  contest, keyed to the sport's STAT_SCHEMAS field vocabulary. Key
 *  membership is checked in the SERVER lib against the competition's
 *  sport_key (this file stays registry-free, the 113 convention);
 *  provenance is stamped SERVER-side by writer authority, never accepted
 *  from the client. */
export const StatLinesUpsertSchema = z.object({
  contestId: uuid,
  lines: z
    .array(
      z.object({
        profileId: uuid,
        teamId: uuid.optional(),
        stats: z
          .record(z.string().max(40), z.number().finite())
          .refine(s => Object.keys(s).length >= 1 && Object.keys(s).length <= 30, {
            message: 'A stat line needs 1–30 stats',
          }),
      })
    )
    .min(1)
    .max(60),
});
export type StatLinesUpsertInput = z.infer<typeof StatLinesUpsertSchema>;

/** R4: the owner decides a pending cross-org entry. */
export const EntryDecideSchema = z.object({
  entryId: uuid,
  decision: z.enum(['approved', 'rejected']),
});
export type EntryDecideInput = z.infer<typeof EntryDecideSchema>;

/** Track 2 PR 7 (219): a meet athlete's affiliation, organizer-editable (null = unattached). The entries PATCH takes either shape. */
export const EntryAffiliationSchema = z.object({
  entryId: uuid,
  affiliationTeamId: uuid.nullable(),
});
export type EntryAffiliationInput = z.infer<typeof EntryAffiliationSchema>;
/** Leftovers PR 1: a pool letter on a fixture entry (null clears). The entries PATCH takes one intent per call — the route dispatches by key. */
export const EntryPoolSchema = z.object({
  entryId: uuid,
  pool: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']).nullable(),
});
export type EntryPoolInput = z.infer<typeof EntryPoolSchema>;
export const EntryPatchSchema = z.union([EntryDecideSchema, EntryAffiliationSchema, EntryPoolSchema]);

/** Leftovers PR 2: the round-robin per pool (dry-run by default; one or two legs). */
export const PoolsGenerateSchema = z.object({
  competitionId: uuid,
  dryRun: z.boolean().default(true),
  legs: z.union([z.literal(1), z.literal(2)]).default(1),
});
export type PoolsGenerateInput = z.infer<typeof PoolsGenerateSchema>;

/** Leftovers PR 2: seed a bracket competition from the pools' tables — the top n of each pool, crossed (A1, B1, …, A2, B2 …). */
export const PoolsSeedSchema = z.object({
  competitionId: uuid,
  targetCompetitionId: uuid,
  perPool: z.number().int().min(1).max(8),
});
export type PoolsSeedInput = z.infer<typeof PoolsSeedSchema>;

/** Track 2 PR 10: run a two-sided contest as a one-round game EVENT of the competition's sport, hosted for the org. */
export const ContestRunAsEventSchema = z.object({
  competitionId: uuid,
  contestId: uuid,
  scheduledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'scheduledOn must be a date (YYYY-MM-DD)'),
  startsAt: z.string().datetime({ offset: true }).optional(),
  place: boundedText(200).optional(),
  /** PR 11: a golf bracket match — its course and gross / net. */
  courseId: uuid.optional(),
  format: z.enum(['match_gross', 'match_net']).optional(),
  selfEntry: z.boolean().default(true),
  visibility: z.enum(['public', 'private']).default('public'),
});
export type ContestRunAsEventInput = z.infer<typeof ContestRunAsEventSchema>;

/** Track 2 PR 7: mint one contest per chosen meet event (the sport profile's vocabulary), in one session. */
export const MeetEventsGenerateSchema = z.object({
  competitionId: uuid,
  eventKeys: z.array(boundedText(40)).min(1).max(40),
  session: z.number().int().min(1).max(20).default(1),
});
export type MeetEventsGenerateInput = z.infer<typeof MeetEventsGenerateSchema>;

/** Leftovers PR 4: ONE calendar event for a meet session — its start (and end), zone and venue; every contest of the session shares it. */
export const MeetSessionPublishSchema = z
  .object({
    competitionId: uuid,
    session: z.number().int().min(1).max(20),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }).optional(),
    timezone: boundedText(64).default('UTC'),
    venueId: uuid.nullable().optional(),
  })
  .refine(v => !v.endsAt || Date.parse(v.endsAt) > Date.parse(v.startsAt), { path: ['endsAt'], message: 'The session ends before it starts' });
export type MeetSessionPublishInput = z.infer<typeof MeetSessionPublishSchema>;

/** Track 2 PR 7: the marks of one meet event — text marks ("11.85", "4:05.30", "6.42m") parsed server-side; a DQ carries no mark. */
export const MeetResultsUpsertSchema = z.object({
  contestId: uuid,
  marks: z
    .array(
      z.object({
        entryId: uuid,
        mark: z.string().trim().max(20).optional(),
        wind: z.number().finite().min(-20).max(20).optional(),
        dq: z.boolean().optional(),
      })
    )
    .min(1)
    .max(200),
});
export type MeetResultsUpsertInput = z.infer<typeof MeetResultsUpsertSchema>;

/** One entrant, kind-matched to the competition's entrant_type in the
 *  server lib (never trusted from the client). */
export const EntryAddSchema = z
  .object({
    competitionId: uuid,
    teamId: uuid.optional(),
    profileId: uuid.optional(),
    /** Track 2 PR 6 (219): an AD-HOC entry — a named side with members from the org's roster. */
    name: boundedText(80).optional(),
    memberProfileIds: z.array(uuid).max(30).optional(),
  })
  .superRefine((val, ctx) => {
    const kinds = [val.teamId, val.profileId, val.name].filter(Boolean).length;
    if (kinds !== 1) {
      ctx.addIssue({ code: 'custom', path: ['teamId'], message: 'Exactly one of teamId, profileId or name' });
    }
    if (val.memberProfileIds && !val.name) {
      ctx.addIssue({ code: 'custom', path: ['memberProfileIds'], message: 'Members belong to an ad-hoc entry (name)' });
    }
  });
export type EntryAddInput = z.infer<typeof EntryAddSchema>;

// Round 4: "Start our season" for a TEAM sport — the season + a fixture
// competition + every team; the sport is the org's (validated by name).
export const SeasonQuickstartSchema = z.object({
  sport: z.string().regex(/^[a-z_]{2,32}$/),
});

// Onboarding v2 R4: "Start our season" — one POST composes season +
// golf leaderboard + entries + activation + weekly windows.
export const GolfQuickstartSchema = z.object({
  holes: z.union([z.literal(9), z.literal(18)]),
  weeks: z.number().int().min(1).max(52),
  windowDays: z.number().int().min(1).max(14),
  startDate: z.string().regex(ISO_DATE_RE, 'YYYY-MM-DD').optional(),
  /** A venue linked to a catalog course; absent ⇒ any course counts. */
  venueId: uuid.nullable().optional(),
  publishToCalendar: z.boolean().optional(),
  timezone: boundedText(64).optional(),
});
export type GolfQuickstartInput = z.infer<typeof GolfQuickstartSchema>;
