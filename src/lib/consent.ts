// Verifiable-parental-consent state (guardian-profiles, Phase 3b).
// consent_records is APPEND-ONLY: current state = the latest row's action.
// Method for launch: signed_form upload + admin review (approved COPPA
// method; card-charge is the designated upgrade once billing exists).

import type { SupabaseClient } from '@supabase/supabase-js';

export const CONSENT_POLICY_VERSION = 'minors-consent-v1';

export type ConsentState =
  | 'none'            // nothing submitted
  | 'pending_review'  // guardian granted; awaiting admin review
  | 'approved'        // review_approved — profile may be published/unlocked
  | 'rejected'        // review_rejected — guardian must re-submit
  | 'withdrawn';      // guardian withdrew — hard-delete path

export function stateFromAction(action: string | null | undefined): ConsentState {
  switch (action) {
    case 'granted': return 'pending_review';
    case 'review_approved': return 'approved';
    case 'review_rejected': return 'rejected';
    case 'withdrawn': return 'withdrawn';
    case 'superseded': return 'none';
    default: return 'none';
  }
}

/** Latest consent row decides the state. Admin client required (RLS: none). */
export async function getConsentState(
  admin: SupabaseClient,
  profileId: string
): Promise<ConsentState> {
  const { data } = await admin
    .from('consent_records')
    .select('action')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return stateFromAction(data?.action);
}

/** Guardian-facing consent statement (policy v1). Shown before signing. */
export const CONSENT_STATEMENT = `Edge Athlete Parental Consent — ${CONSENT_POLICY_VERSION}

I confirm that I am the parent or legal guardian of the athlete named on
this profile, and I consent to Edge Athlete collecting and displaying the
information I choose to add to their profile (name, date of birth, sport
statistics, photos and videos) for the purpose of operating their athlete
profile.

I understand that:
- The profile starts private, and nothing is visible to others until I
  approve it.
- I control the profile's privacy, what gets posted, and who can contact
  my athlete, and I can change these at any time.
- I may withdraw this consent at any time from my account settings, which
  permanently deletes the profile and its content.

To provide verifiable consent, print or write this statement, sign and
date it, and upload a photo or scan below.`;
