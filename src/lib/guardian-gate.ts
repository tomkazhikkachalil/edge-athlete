// ── Acting-as gate (guardian-profiles) ───────────────────────────────────────
// THE single implementation of "may this session write content as
// targetProfileId?" — flag → 404, guardian row → 403, approved consent → 403.
// Posts, comments, and group-posts each used to hand-roll this verbatim,
// which is exactly how group-posts once shipped a drifted copy (Round C's
// misattribution bug). New content routes must call this, not re-derive it.
//
// The SUPERVISED-SELF pipeline is deliberately NOT here: what happens when a
// child writes to their own profile (posts → pending_approval, comments →
// the comment_moderation toggle, shared rounds → publish immediately, a
// documented exception) is per-content-type policy owned by each route.

/** Byte-identical consent copy across all three content routes — probes
 *  assert it verbatim. */
export const CONSENT_REQUIRED_MESSAGE =
  'Parental consent must be approved before anything can be posted to this profile.';

export type ActingGate =
  | {
      ok: true;
      /** The profile the content belongs to (the child when acting-as). */
      actorId: string;
      /** True only for a guardian writing as a managed athlete — the caller
       *  routes these writes through the admin client (RLS's
       *  `auth.uid() = owner` can't hold; this gate IS the authorization). */
      actingAs: boolean;
    }
  | { ok: false; status: 403 | 404; error: string };

/** Test seam: the two lookups, injectable so the decision table is
 *  node-testable without a Supabase client. Production callers omit it. */
export interface ActingGateIO {
  getRole: (userId: string, profileId: string) => Promise<string | null>;
  getConsent: (profileId: string) => Promise<string>;
}

export async function resolveActingProfile(
  userId: string,
  targetProfileId: string | null | undefined,
  roleError: string,
  io?: ActingGateIO
): Promise<ActingGate> {
  if (!targetProfileId || targetProfileId === userId) {
    return { ok: true, actorId: userId, actingAs: false };
  }
  const { FEATURE_FLAGS } = await import('@/lib/features');
  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
    return { ok: false, status: 404, error: 'Not available' };
  }
  const role = io
    ? await io.getRole(userId, targetProfileId)
    : await (await import('@/lib/auth-server')).getProfileRole(userId, targetProfileId);
  if (role !== 'guardian') {
    return { ok: false, status: 403, error: roleError };
  }
  const consent = io
    ? await io.getConsent(targetProfileId)
    : await (async () => {
        const { getSupabaseAdmin } = await import('@/lib/auth-server');
        const { getConsentState } = await import('@/lib/consent');
        return getConsentState(getSupabaseAdmin(), targetProfileId);
      })();
  if (consent !== 'approved') {
    return { ok: false, status: 403, error: CONSENT_REQUIRED_MESSAGE };
  }
  return { ok: true, actorId: targetProfileId, actingAs: true };
}
