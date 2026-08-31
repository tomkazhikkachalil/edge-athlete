/**
 * Affiliations (118) — the tiny pure schemas. The league route's bodies
 * carry `clubId`, the club route's carry `leagueId`; both funnel into the
 * shared core as a `targetId`.
 */

import { z } from 'zod';
import { uuid } from '@/lib/validation';

/** 143's vocabulary. Direction reads FROM THE CLUB'S side ("the club is a
 *  member_of the league"); partner_of is symmetric. district_of arrives
 *  with org unification. Defaulted so pre-143 callers stay valid. */
export const AffiliationTypeSchema = z.enum(['partner_of', 'member_of', 'sanctioned_by']);
export type AffiliationType = z.infer<typeof AffiliationTypeSchema>;

export const AffiliationClubTargetSchema = z.object({
  clubId: uuid,
  affiliationType: AffiliationTypeSchema.default('partner_of'),
});
export const AffiliationLeagueTargetSchema = z.object({
  leagueId: uuid,
  affiliationType: AffiliationTypeSchema.default('partner_of'),
});

export const AffiliationAcceptClubSchema = z.object({
  clubId: uuid,
  action: z.literal('accept'),
});
export const AffiliationAcceptLeagueSchema = z.object({
  leagueId: uuid,
  action: z.literal('accept'),
});
