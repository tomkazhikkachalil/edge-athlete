/**
 * Result/stat-line provenance — the ONE stamping rule (phase 4, R1).
 *
 * The masterplan's five-rung ladder is the integrity story behind the
 * recruiting dataset ("the part a scout will actually interrogate"), so
 * the rules live here once, pure and node-tested, and both writers
 * (contest_results in competition-server, contest_stat_lines in
 * stat-lines-server) call the same functions.
 *
 * Two-part design, deliberate:
 *  1. The STORED rung records the entry act — who had what authority when
 *     they wrote the row. It never changes retroactively.
 *  2. 'sanctioned' is a DISPLAY tier, derived at read time: a
 *     league-verified result upgrades when the owning league holds an
 *     active sanctioned_by affiliation edge to the athlete's club.
 *     Derived-not-stored because the org graph mutates — a stored
 *     'sanctioned' would need a backfill every time an affiliation
 *     changes, and the read path already joins the competition anyway.
 *     Consequence (intended): the displayed chip can change when
 *     affiliations change; the stored rung cannot.
 *
 * 'self_reported' and 'imported' are reserved for athlete entry and
 * migration tooling (later phases) — the CHECKs accept them, nothing
 * writes them yet.
 */

export type ResultProvenance =
  | 'sanctioned'
  | 'league_verified'
  | 'club_recorded'
  | 'self_reported'
  | 'imported';

/** How the writer reached the write — resolved by the server lib's scope
 *  check, never claimed by the client. */
export type WriterAuthority = 'owner' | 'participant';

/** The stored rung for a fresh write. Owning-org managers ARE the
 *  competition authority ('league_verified' — true for club-owned house
 *  leagues too: "league" here means the competition owner, not the org
 *  type). Participating-team club staff record for their own players
 *  without the owner's authority ('club_recorded'). */
export function stampProvenance(authority: WriterAuthority): ResultProvenance {
  return authority === 'owner' ? 'league_verified' : 'club_recorded';
}

/** True when `next` may overwrite a row already stamped `existing`.
 *  The no-silent-downgrade rule: club staff cannot replace the owner's
 *  verified row (last-write-wins must not decide a season — masterplan
 *  §7); the owner can replace anything. */
export function canOverwriteProvenance(
  existing: ResultProvenance,
  authority: WriterAuthority
): boolean {
  if (authority === 'owner') return true;
  return existing === 'club_recorded' || existing === 'self_reported';
}

export interface SanctionContext {
  /** The competition owner is a league (clubs cannot sanction). */
  ownerIsLeague: boolean;
  /** The owning league holds an ACTIVE member_of/sanctioned_by edge of
   *  type 'sanctioned_by' to the athlete's participating club. */
  sanctionedEdgeToClub: boolean;
}

/** The tier a reader displays for a stored rung. Only 'league_verified'
 *  can upgrade, and only through a live sanctioning edge. */
export function deriveDisplayTier(
  stored: ResultProvenance,
  ctx: SanctionContext
): ResultProvenance {
  if (stored === 'league_verified' && ctx.ownerIsLeague && ctx.sanctionedEdgeToClub) {
    return 'sanctioned';
  }
  return stored;
}
