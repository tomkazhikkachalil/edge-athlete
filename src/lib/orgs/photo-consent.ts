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
  byUserId: string
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
    .eq('kind', 'roster')
    .eq('scope_type', 'org')
    .select('id');
  if (error) {
    if (isMissingColumnError(error.code)) return 'unavailable';
    console.error('[PHOTO CONSENT] write error:', error);
    return 'error';
  }
  return (data ?? []).length > 0 ? 'ok' : 'no_row';
}
