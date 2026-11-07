// ── The password of an account nobody types into (Nov 7 2026) ───────────────
// A shadow auth user — a roster stub, a supervised minor, a transferred
// athlete's rotated credentials — carries a password that only has to be
// ACCEPTED, never remembered. Production's Auth enforces the strongest
// Supabase policy (one lower, one upper, one digit, one symbol); a bare
// base64url string of 32 random bytes misses a symbol about one time in
// four, and the roster import's production probe refused a row in four with
// `422 Password should contain at least one character of each…`. The
// suffix guarantees every class on top of 256 bits of randomness.

import { randomBytes } from 'crypto';

export const SHADOW_PASSWORD_SUFFIX = 'Aa1!';

/** The four classes Supabase's strictest policy asks for. */
export function hasEveryPasswordClass(password: string): boolean {
  return /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
}

/** 256 random bits (base64url) plus one of each class. */
export function shadowPassword(): string {
  return `${randomBytes(32).toString('base64url')}${SHADOW_PASSWORD_SUFFIX}`;
}
