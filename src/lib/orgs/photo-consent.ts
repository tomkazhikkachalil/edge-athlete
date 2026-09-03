// ── Photo consent — the per-org publication grant (phase 4 R4, mig 159) ─────
// The masterplan's non-negotiable guardian gate, as one small module:
// who may grant, where it is stored (the ORG-SCOPE roster row), and the
// fail-safe readers every public surface uses. NULL, false, a missing
// column ('42703', pre-159) and a missing row ALL read as "no consent" —
// there is no code path where absence publishes anything.
//
// DELIBERATELY NOT consent_records: that is the global COPPA
// posting-consent state. This is per-org, revocable, membership-scoped.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

/** Postgres 42703 = column does not exist — the pre-159 database. */
function isMissingColumnError(code: string | null | undefined): boolean {
  return code === '42703';
}

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

/**
 * Who may set a membership's photo consent (pure, node-tested):
 * a SUPERVISED athlete's consent is guardian-only — the athlete cannot
 * consent themselves and neither can the org; an unsupervised (adult)
 * athlete self-consents, and a guardian may also act for them (the
 * household seats model). Orgs NEVER write consent.
 */
export function canGrantPhotoConsent(input: {
  actorIsSelf: boolean;
  actorIsGuardian: boolean;
  subjectSupervised: boolean;
}): boolean {
  if (input.actorIsGuardian) return true;
  return input.actorIsSelf && !input.subjectSupervised;
}

/**
 * Consent per profile for one org, from the ORG-SCOPE roster rows.
 * Only `true` grants; NULL/false/missing-row/missing-column are all "no".
 * Never throws.
 */
export async function photoConsentByProfile(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileIds: string[]
): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  if (profileIds.length === 0) return map;
  try {
    const { data, error } = await admin
      .from('memberships')
      .select('profile_id, photo_consent')
      .eq(orgColumn(side), orgId)
      .eq('kind', 'roster')
      .eq('scope_type', 'org')
      .eq('status', 'active')
      .in('profile_id', profileIds);
    if (error) return map; // pre-159 or any failure ⇒ nothing consented
    for (const row of data ?? []) {
      map.set(row.profile_id as string, row.photo_consent === true);
    }
  } catch {
    // fail safe
  }
  return map;
}

/**
 * Write the consent decision onto the org-scope roster row. Returns
 * 'ok' | 'no_row' | 'unavailable' (pre-159) | 'error'. Authorization is
 * the CALLER's job (canGrantPhotoConsent + the route's acting-for gate).
 */
export async function setPhotoConsent(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string,
  consent: boolean,
  byUserId: string,
  /** M2 (program 10): which row carries the grant. 'roster' = the
   *  contest-media grant (phase 4); 'follow' = the ROUND-PHOTO grant a
   *  golf club member gives on their own membership row. Two separate
   *  grants — never OR them (roster ⊆ follow, so a rostered member
   *  holds both rows and decides each on its own). */
  kind: 'roster' | 'follow' = 'roster'
): Promise<'ok' | 'no_row' | 'unavailable' | 'error'> {
  const { data, error } = await admin
    .from('memberships')
    .update({
      photo_consent: consent,
      photo_consent_at: new Date().toISOString(),
      photo_consent_by: byUserId,
    })
    .eq(orgColumn(side), orgId)
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .eq('scope_type', 'org')
    .select('id');
  if (error) {
    if (isMissingColumnError(error.code)) return 'unavailable';
    console.error('[PHOTO CONSENT] write error:', error);
    return 'error';
  }
  return (data ?? []).length > 0 ? 'ok' : 'no_row';
}

// ── M2 (program 10): the round-photo grant on the FOLLOW row ────────────────
// "Share my round photos with this club": a member's own decision, stored
// on their follow membership (golf club members are follow rows; rostering
// stays manual). The contest gallery gate and the guardian queue keep
// reading roster rows only — this grant is invisible to them by design.
// Same fail-safe reads: anything but `true` on an active org-scope follow
// row is "no".

export function setRoundPhotoConsent(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string,
  consent: boolean,
  byUserId: string
): Promise<'ok' | 'no_row' | 'unavailable' | 'error'> {
  return setPhotoConsent(admin, side, orgId, profileId, consent, byUserId, 'follow');
}

export async function roundPhotoConsentFor(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string
): Promise<boolean> {
  try {
    const { data, error } = await admin
      .from('memberships')
      .select('photo_consent')
      .eq(orgColumn(side), orgId)
      .eq('profile_id', profileId)
      .eq('kind', 'follow')
      .eq('scope_type', 'org')
      .eq('status', 'active')
      .limit(1);
    if (error || !data || data.length === 0) return false;
    return data[0].photo_consent === true;
  } catch {
    return false;
  }
}
