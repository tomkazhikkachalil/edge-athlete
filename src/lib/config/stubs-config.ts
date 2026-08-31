// ── Stub-athlete identity config (phase 1 R3) ───────────────────────────────
// Roster-imported stub profiles carry a reserved, unroutable email domain.
// DELIBERATELY separate from minors-config: `isSyntheticEmail`
// (@minors.invalid) keeps its documented meaning — "supervised minor with
// guardian email routing" — while stubs may be ADULTS awaiting claim.
//
// THE INVARIANT: @stubs.invalid ⇔ unclaimed. The adult claim swaps in the
// real email; the guardian claim re-keys to @minors.invalid
// (makeSyntheticEmail) so the supervised-minor machinery takes over. The
// Unclaimed chip and the re-mint guards both key on this.

export const STUB_EMAIL_DOMAIN = 'stubs.invalid';

export const ATHLETE_CLAIM_EXPIRY_DAYS = 30;

export function isStubEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${STUB_EMAIL_DOMAIN}`);
}

export function makeStubEmail(profileId: string): string {
  return `${profileId}@${STUB_EMAIL_DOMAIN}`;
}
