/**
 * Minors / guardian-profiles configuration.
 *
 * Age thresholds are per-jurisdiction and configurable — never hardcode a
 * threshold at a call site. The threshold applied to a profile is SNAPSHOTTED
 * onto the row at consent time (profiles.jurisdiction +
 * profiles.minor_threshold_age); these values govern NEW consents only.
 * Jurisdiction is chosen explicitly by the guardian at the consent step,
 * defaulted from the x-vercel-ip-country / x-vercel-ip-country-region hints.
 */

// Digital-consent age by jurisdiction code. Country codes are ISO 3166-1
// alpha-2; sub-national entries use COUNTRY-REGION (Vercel region hint).
export const MINOR_AGE_THRESHOLDS = {
  US: 13, // COPPA — verifiable parental consent under 13
  CA: 13, // PIPEDA guidance
  'CA-QC': 14, // Quebec Law 25
  GB: 13,
  // GDPR Art. 8 — member states set 13–16:
  DE: 16,
  FR: 15,
  IE: 16,
  NL: 16,
  IT: 14,
  ES: 14,
  // Most-restrictive fallback for everywhere else:
  DEFAULT: 16,
} as const;

export type Jurisdiction = keyof typeof MINOR_AGE_THRESHOLDS;

export function getMinorThreshold(jurisdiction: string | null | undefined): number {
  if (!jurisdiction) return MINOR_AGE_THRESHOLDS.DEFAULT;
  const key = jurisdiction.toUpperCase();
  return (
    MINOR_AGE_THRESHOLDS[key as Jurisdiction] ?? MINOR_AGE_THRESHOLDS.DEFAULT
  );
}

/** Age in whole years as of `asOf` (defaults handled by caller — no Date.now here). */
export function ageOn(dob: string, asOf: string): number {
  const b = new Date(`${dob}T00:00:00Z`);
  const a = new Date(`${asOf}T00:00:00Z`);
  let age = a.getUTCFullYear() - b.getUTCFullYear();
  const monthDiff = a.getUTCMonth() - b.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && a.getUTCDate() < b.getUTCDate())) {
    age--;
  }
  return age;
}

/**
 * Autonomy-ladder anchors (Wave 8). The jurisdiction consent threshold
 * (13–16 above) stays the ONE legally meaningful boundary — these two are
 * product steps around it: under childMax = the stricter "younger kids"
 * policy band; at adult = the handover-moment prompt (nothing automatic).
 */
export const LADDER_AGES = {
  /** Below this = the 'child' policy band (childDefaults). */
  childMax: 13,
  /** At/after this = the 'adult' band + the handover prompt (8C). */
  adult: 18,
} as const;

/** Under the jurisdiction's consent age on the given date? */
export function isUnderThreshold(
  dob: string,
  jurisdiction: string | null | undefined,
  asOf: string
): boolean {
  return ageOn(dob, asOf) < getMinorThreshold(jurisdiction);
}

/**
 * Shadow-identity synthetic emails (guardian-created minors before the
 * athlete activates a login). `.invalid` is an IETF-reserved TLD — never
 * routable. These must never render in UI.
 */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith('@minors.invalid');
}

export function makeSyntheticEmail(profileId: string): string {
  return `${profileId}@minors.invalid`;
}

/**
 * Jurisdiction from Vercel's IP hints (x-vercel-ip-country /
 * x-vercel-ip-country-region). Used only as the DEFAULT at the consent step —
 * the guardian confirms explicitly before anything is snapshotted.
 */
export function jurisdictionFromHeaders(
  country: string | null | undefined,
  region: string | null | undefined
): string {
  if (!country) return 'DEFAULT';
  const c = country.toUpperCase();
  if (c === 'CA' && region?.toUpperCase() === 'QC') return 'CA-QC';
  return c;
}

// Flow constants
export const GUARDIAN_INVITE_EXPIRY_DAYS = 7;
export const PENDING_PROFILE_EXPIRY_DAYS = 30;
export const TRANSFER_COOLING_OFF_DAYS = 7;
export const TRANSFER_STEP_EXPIRY_DAYS = 14;
export const MAX_GUARDIANS_PER_PROFILE = 2;
