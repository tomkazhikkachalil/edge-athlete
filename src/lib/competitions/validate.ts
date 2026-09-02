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

export { isMissingTableError } from '@/lib/leagues/validate';
export { OrgSideSchema } from '@/lib/structure/validate';
import { OrgSideSchema } from '@/lib/structure/validate';

/** The v1 creatable pairs. Widening a round = widening THIS, not the DB. */
export const COMPETITION_FORMATS_V1 = ['fixture', 'leaderboard'] as const;
export const FORMAT_ENTRANTS: Record<(typeof COMPETITION_FORMATS_V1)[number], 'team' | 'athlete'> = {
  fixture: 'team',
  leaderboard: 'athlete',
};

/** Phase 6c G1: a bare calendar date (golf_rounds.date is a DATE). */
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const CompetitionCreateSchema = z
  .object({
    side: OrgSideSchema,
    orgId: uuid,
    seasonId: uuid,
    divisionId: uuid.optional(),
    sportKey: boundedText(40),
    name: boundedText(80),
    format: z.enum(COMPETITION_FORMATS_V1),
    scoringRule: optionalText(40),
    visibility: z.enum(['public', 'private']).default('private'),
    // Phase 6c G1: shape-blind competition config; the first key is the
    // golf league's counting-round choice.
    config: z
      .object({
        golf: z.object({ pick: z.enum(['first', 'best']) }).optional(),
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

/** One entrant, kind-matched to the competition's entrant_type in the
 *  server lib (never trusted from the client). */
export const EntryAddSchema = z
  .object({
    competitionId: uuid,
    teamId: uuid.optional(),
    profileId: uuid.optional(),
  })
  .superRefine((val, ctx) => {
    const kinds = [val.teamId, val.profileId].filter(Boolean).length;
    if (kinds !== 1) {
      ctx.addIssue({ code: 'custom', path: ['teamId'], message: 'Exactly one of teamId or profileId' });
    }
  });
export type EntryAddInput = z.infer<typeof EntryAddSchema>;
