// ── Self-serve roster opt-in (Onboarding v2 R3) ─────────────────────────────
// Joining a club writes a `follow` row; being COUNTED in its leagues needs a
// `roster` row (competition entry reads kind='roster' — the follow edge is
// never a pipe, masterplan §8 invariant 3). Before R3 the only ways onto
// the roster were a manager's invite + the member's accept, or a CSV import
// that needs a team. Now a member can opt in themselves:
//
//   unsupervised adult, consent    → self_accept   (offer + accept in one act —
//                                                   the same PATCH they'd do anyway)
//   supervised athlete, consent    → offer_pending (the pending row + the
//                                                   guardian bell; EITHER-approves
//                                                   accepts — the rail is untouched)
//   any live roster edge already   → skip          (already counted / already asked)
//   no consent                     → skip
//
// Pure; node-tested. The server half is rosterSelfPost in roster-server.ts.

export type AutoRosterDecision = 'self_accept' | 'offer_pending' | 'skip';

export function autoRosterDecision(input: {
  consent: boolean;
  supervised: boolean;
  /** The member's live roster edge status (pending | active | placed | …), or null. */
  liveEdgeStatus: string | null;
}): AutoRosterDecision {
  if (!input.consent) return 'skip';
  if (input.liveEdgeStatus && input.liveEdgeStatus !== 'pending') return 'skip';
  if (input.supervised) return input.liveEdgeStatus === 'pending' ? 'skip' : 'offer_pending';
  // An adult with a pending offer already on the table accepts it.
  return 'self_accept';
}
