// Pure helpers for the signup route's error handling. Kept free of Supabase
// imports so they're unit-testable without mocks (same pattern as
// storage-sweep.ts).

/** Structurally compatible with supabase-js PostgrestError. */
export interface ProfileErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

export interface MappedError {
  status: number;
  error: string;
}

/**
 * Map a profiles-upsert failure to a user-facing response.
 *
 * 23505 (unique_violation) is matched on constraint name rather than the
 * words "duplicate"/"unique" — previously a foreign-key violation whose
 * message happened to contain "duplicate" misreported as "handle taken".
 */
export function mapProfileUpsertError(e: ProfileErrorLike): MappedError {
  const text = `${e.message ?? ''} ${e.details ?? ''}`;
  if (e.code === '23505') {
    if (text.includes('profiles_handle_key') || /handle/i.test(text)) {
      return {
        status: 409,
        error: 'This handle is already taken. Please choose a different one.',
      };
    }
    if (text.includes('profiles_email_key') || /email/i.test(text)) {
      return {
        status: 409,
        error: 'This email is already registered. Please log in instead.',
      };
    }
    return {
      status: 409,
      error: 'This profile conflicts with an existing account. Please try again.',
    };
  }
  if (e.code === '23502') {
    return {
      status: 400,
      error:
        'Required profile information is missing. Please ensure all required fields are filled.',
    };
  }
  if (e.code === '23503') {
    return {
      status: 500,
      error:
        'Account setup failed due to a data error. Please try again or contact support.',
    };
  }
  return { status: 500, error: `Database error: ${e.message ?? 'unknown'}` };
}

/**
 * With email confirmations ON, supabase.auth.signUp for an already-registered
 * email returns a sanitized fake user (fresh UUID, empty identities) instead
 * of an error, to avoid leaking which emails exist. With confirmations OFF an
 * explicit error is returned instead — that path is handled separately.
 */
export function isObfuscatedDuplicateSignUp(
  user: { identities?: unknown[] | null } | null | undefined
): boolean {
  return !!user && (user.identities?.length ?? 0) === 0;
}
