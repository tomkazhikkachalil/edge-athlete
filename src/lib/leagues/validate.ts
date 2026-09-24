/**
 * Leagues — the validators, under their league names. Since Round 5 step E
 * every schema lives in `src/lib/orgs/validate.ts` (one module for both
 * kinds; the league's one designed divergence is its required sportKey);
 * this file re-exports them for its importers and is retired in step F.
 */

export {
  PlaceValueSchema,
  LeagueCreateSchema,
  LeagueRequestSchema,
  OrgUpdateSchema as LeagueUpdateSchema,
  OrgJoinDecisionSchema as LeagueJoinDecisionSchema,
  OrgRequestDecisionSchema as LeagueRequestDecisionSchema,
  OrgMemberRoleSchema as LeagueMemberRoleSchema,
  RosterAcceptSchema,
  RosterImportSchema,
  placeToOrgColumns as placeToLeagueColumns,
  isMissingTableError,
} from '@/lib/orgs/validate';
export type {
  OrgPlace as LeaguePlace,
  LeagueCreateInput,
  LeagueRequestInput,
  OrgUpdateInput as LeagueUpdateInput,
  OrgJoinDecisionInput as LeagueJoinDecisionInput,
  OrgRequestDecisionInput as LeagueRequestDecisionInput,
  OrgMemberRoleInput as LeagueMemberRoleInput,
  RosterImportInput,
} from '@/lib/orgs/validate';
