/**
 * Affiliations (118) — the tiny pure schemas. The league route's bodies
 * carry `clubId`, the club route's carry `leagueId`; both funnel into the
 * shared core as a `targetId`.
 */

import { z } from 'zod';
import { uuid } from '@/lib/validation';

export const AffiliationClubTargetSchema = z.object({ clubId: uuid });
export const AffiliationLeagueTargetSchema = z.object({ leagueId: uuid });

export const AffiliationAcceptClubSchema = z.object({
  clubId: uuid,
  action: z.literal('accept'),
});
export const AffiliationAcceptLeagueSchema = z.object({
  leagueId: uuid,
  action: z.literal('accept'),
});
