// Pure helpers for deriving profile fields from OAuth provider metadata.
// Kept Supabase-free so they're unit-testable without mocks (same pattern
// as signup-errors.ts).

export interface OAuthMetadataLike {
  given_name?: string;
  family_name?: string;
  full_name?: string;
  name?: string;
  avatar_url?: string;
  picture?: string;
}

export function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

/**
 * Best-effort first/last name from provider metadata.
 *
 * Google sends given_name/family_name; Apple sends full name ONLY on the
 * very first authorization (subsequent sign-ins have no name at all), so
 * the email local-part fallback is load-bearing, not cosmetic.
 */
export function deriveNamesFromMetadata(
  meta: OAuthMetadataLike | null | undefined,
  email: string | null | undefined
): { firstName: string; lastName: string } {
  if (meta?.given_name || meta?.family_name) {
    return { firstName: meta.given_name ?? '', lastName: meta.family_name ?? '' };
  }
  const full = meta?.full_name || meta?.name;
  if (full && full.trim()) {
    const { first, last } = splitFullName(full);
    return { firstName: first, lastName: last };
  }
  const local = email?.split('@')[0];
  if (local) {
    return { firstName: local, lastName: '' };
  }
  return { firstName: '', lastName: '' };
}

export function deriveAvatarUrl(
  meta: OAuthMetadataLike | null | undefined
): string | null {
  return meta?.avatar_url || meta?.picture || null;
}
