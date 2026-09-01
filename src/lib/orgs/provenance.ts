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
  /** The owning league holds an ACTIVE sanctioned_by edge to the
   *  athlete's participating club — DIRECTLY, or through the league
   *  chain (phase 6 R3): a league sanctioned by its parent (transitively)
   *  passes the sanction down to its clubs. Callers feed this from
   *  resolveSanctionedPairs. */
  sanctionedEdgeToClub: boolean;
}

/** A live league→club sanctioning edge. */
export interface ClubSanctionEdge {
  leagueId: string;
  clubId: string;
}

/** A live child-league→parent-league sanctioning edge (mig 167). */
export interface LeagueSanctionEdge {
  leagueId: string;
  parentLeagueId: string;
}

/**
 * The chain resolver (phase 6 R3), pure. The rule: a (competition-owner
 * league, club) pair counts as sanctioned when both sit under a COMMON
 * sanctioning authority —
 *   * the owner itself directly sanctions the club (the pre-167 case),
 *   * an ancestor of the owner sanctions the club (KMHA runs the
 *     competition; the District sanctions the club),
 *   * or the club's direct sanctioner and the owner share an ancestor
 *     (both under the same Federation).
 * Formally: ancestors(owner) ∩ sanctioners(club) ≠ ∅, where ancestors
 * walks UP sanctioned_by parent edges (bounded, cycle-safe, includes the
 * league itself) and sanctioners(club) = the ancestors of every league
 * holding a direct sanctioned_by edge to the club. Only sanctioned_by
 * edges chain — member_of/partner_of never upgrade provenance.
 */
export function resolveSanctionedPairs(
  clubEdges: ClubSanctionEdge[],
  leagueEdges: LeagueSanctionEdge[],
  ownerLeagueIds: string[],
  opts: { maxDepth?: number } = {}
): Set<string> {
  const maxDepth = opts.maxDepth ?? 3;
  const parentsOf = new Map<string, string[]>();
  for (const e of leagueEdges) {
    const list = parentsOf.get(e.leagueId) ?? [];
    list.push(e.parentLeagueId);
    parentsOf.set(e.leagueId, list);
  }
  const ancestorsCache = new Map<string, Set<string>>();
  const ancestors = (league: string): Set<string> => {
    const cached = ancestorsCache.get(league);
    if (cached) return cached;
    const seen = new Set<string>([league]);
    let frontier = [league];
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const l of frontier) {
        for (const p of parentsOf.get(l) ?? []) {
          if (!seen.has(p)) {
            seen.add(p);
            next.push(p);
          }
        }
      }
      frontier = next;
    }
    ancestorsCache.set(league, seen);
    return seen;
  };

  // sanctioners(club) = ancestors of every direct league→club sanctioner.
  const sanctionersByClub = new Map<string, Set<string>>();
  for (const e of clubEdges) {
    const set = sanctionersByClub.get(e.clubId) ?? new Set<string>();
    for (const a of ancestors(e.leagueId)) set.add(a);
    sanctionersByClub.set(e.clubId, set);
  }

  const pairs = new Set<string>();
  for (const owner of new Set(ownerLeagueIds)) {
    const up = ancestors(owner);
    for (const [club, sanctioners] of sanctionersByClub) {
      for (const a of up) {
        if (sanctioners.has(a)) {
          pairs.add(`${owner}:${club}`);
          break;
        }
      }
    }
  }
  return pairs;
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
