// Supervised-login credentials (guardian-profiles Phase 4).
//
// DECISIONS (approved): the child signs in with USERNAME (= their handle) +
// password, or a 4–6 digit PIN for younger kids. PIN is never the Supabase
// password itself — it derives one via HMAC(secret, profileId‖pin), so the
// weak secret never exists server-side in usable form and a leaked PIN is
// useless without the profile id + server secret. PIN auth is ONLY valid for
// supervised profiles; the login route hard-rejects everything else.
// Recovery routes to the guardian (no email exists on the child).

import { createHmac } from 'crypto';

export const PIN_REGEX = /^\d{4,6}$/;
export const MIN_PASSWORD_LENGTH = 6;

export function isPinShaped(secret: string): boolean {
  return PIN_REGEX.test(secret);
}

/** Server secret for PIN derivation — service key is server-only already. */
function pinKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('PIN derivation unavailable: service key missing');
  return key;
}

/** The actual Supabase password stored for a PIN credential. */
export function derivePinPassword(profileId: string, pin: string): string {
  return createHmac('sha256', pinKey())
    .update(`${profileId}:${pin}`)
    .digest('base64url');
}

/**
 * Handle/username PII guard for supervised minors: block obvious
 * identity-leaking patterns (full name, name+birth-year). Suggestions come
 * from the existing generator; this only rejects.
 */
export function validateSupervisedHandle(
  handle: string,
  firstName: string,
  lastName: string,
  dobYear: number | null
): { ok: boolean; reason?: string } {
  const h = handle.toLowerCase().replace(/[._]/g, '');
  const first = firstName.trim().toLowerCase();
  const last = lastName.trim().toLowerCase();

  if (first && last && first.length >= 2 && last.length >= 2 && h.includes(first + last)) {
    return {
      ok: false,
      reason: 'For safety, usernames can’t contain a full name. Try a nickname or initials.',
    };
  }
  if (dobYear) {
    const yy = String(dobYear).slice(-2);
    const containsYear = handle.includes(String(dobYear)) || /\d{2}/.test(handle) && handle.includes(yy);
    const containsName = (first.length >= 3 && h.includes(first)) || (last.length >= 3 && h.includes(last));
    if (containsYear && containsName) {
      return {
        ok: false,
        reason: 'For safety, usernames can’t combine a name with a birth year. Try something different.',
      };
    }
  }
  return { ok: true };
}
