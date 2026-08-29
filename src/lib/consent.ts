// Verifiable-parental-consent state (guardian-profiles, Phase 3b).
// consent_records is APPEND-ONLY: current state = the latest row's action.
// Methods: signed_form upload, plus the in-product typed/drawn signatures
// (Wave 3, migration 130). Since Wave 6 every method AUTO-approves at
// submission (Tom's call, Aug 2026): the guardian route appends granted +
// review_approved (reviewed_by NULL = system); the admin dashboard is the
// after-the-fact audit with retro-reject. pending_review survives as the
// degraded path when the approval row fails to write.

import type { SupabaseClient } from '@supabase/supabase-js';

// v2 (Wave 3): the closing paragraph branches per signature method.
export const CONSENT_POLICY_VERSION = 'minors-consent-v2';

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

/** The consent methods the product offers (mig 130; the DB CHECK also keeps
 *  the designated-upgrade values card_charge/id_verification/video_call/
 *  email_plus, which no UI offers yet). */
export type ConsentMethod = 'signed_form' | 'typed_signature' | 'drawn_signature';

/** Parse an untrusted method value; null = not an offered method. */
export function parseConsentMethod(value: unknown): ConsentMethod | null {
  return value === 'signed_form' || value === 'typed_signature' || value === 'drawn_signature'
    ? value
    : null;
}

/** Guardian-facing consent statement, minus the method-specific closing. */
export const CONSENT_STATEMENT_CORE = `Edge Athlete Parental Consent — ${CONSENT_POLICY_VERSION}

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
  permanently deletes the profile and its content.`;

/** The closing paragraph per method — how THIS signature becomes verifiable. */
export const CONSENT_METHOD_CLOSING: Record<ConsentMethod, string> = {
  signed_form: `To provide verifiable consent, print or write this statement, sign and
date it, and upload a photo or scan below.`,
  typed_signature: `To provide verifiable consent, type your full legal name below. Your
typed name is recorded as your signature together with this statement.`,
  drawn_signature: `To provide verifiable consent, sign in the box below with your finger
or mouse. Your signature is recorded together with this statement.`,
};

/** Full statement for a method. */
export function consentStatementFor(method: ConsentMethod): string {
  return `${CONSENT_STATEMENT_CORE}\n\n${CONSENT_METHOD_CLOSING[method]}`;
}

/** Back-compat export — the signed-form variant (pre-Wave-3 sole statement). */
export const CONSENT_STATEMENT = consentStatementFor('signed_form');
