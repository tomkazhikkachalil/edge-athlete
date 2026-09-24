/**
 * Clubs — the validators, under their club names. Since Round 5 step E every
 * schema lives in `src/lib/orgs/validate.ts` (one module for both kinds; a
 * club is multi-sport, so its create schema carries no sport); this file
 * re-exports them for its importers and is retired in step F.
 */

export {
  PlaceValueSchema,
  ClubCreateSchema,
  ClubRequestSchema,
  OrgUpdateSchema as ClubUpdateSchema,
  OrgJoinDecisionSchema as ClubJoinDecisionSchema,
  OrgRequestDecisionSchema as ClubRequestDecisionSchema,
  OrgMemberRoleSchema as ClubMemberRoleSchema,
  RosterAcceptSchema,
  RosterImportSchema,
  placeToOrgColumns as placeToClubColumns,
  isMissingTableError,
} from '@/lib/orgs/validate';
export type {
  OrgPlace as ClubPlace,
  ClubCreateInput,
  ClubRequestInput,
  OrgUpdateInput as ClubUpdateInput,
  OrgJoinDecisionInput as ClubJoinDecisionInput,
  OrgRequestDecisionInput as ClubRequestDecisionInput,
  OrgMemberRoleInput as ClubMemberRoleInput,
} from '@/lib/orgs/validate';
