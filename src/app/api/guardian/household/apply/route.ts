import { NextRequest, NextResponse } from 'next/server';
import { requireGuardianAccount, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { enforceRateLimit } from '@/lib/rate-limit';
import { ageBand, effectivePresets, parseHouseholdPolicy } from '@/lib/household-policy';
import { applySafetyPatch } from '@/lib/safety-settings';

// ── POST /api/guardian/household/apply ───────────────────────────────────────
// Apply the caller's household defaults to their athletes (Wave 4). LOOPS
// the shared per-athlete semantics (applySafetyPatch: supervised gate,
// consent gate on public, changed-only audit rows) — never a bulk update.
// A consent-pending child still gets messaging/moderation: the visibility
// piece is retried out and reported as skipped, honestly.

export async function POST(request: NextRequest) {
  try {
    const { user, athleteIds } = await requireGuardianAccount(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const limited = await enforceRateLimit(request, 'guardian-household-apply', { userId: user.id });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    // Optional narrowing to specific athletes; always intersected with the
    // caller's supervised roster — the scoping IS the authorization.
    const requested: string[] | null = Array.isArray(body.profileIds) ? body.profileIds : null;
    const targets = requested
      ? athleteIds.filter(id => requested.includes(id))
      : athleteIds;

    const admin = getSupabaseAdmin();
    const { data: guardianRow } = await admin
      .from('profiles')
      .select('household_policy')
      .eq('id', user.id)
      .maybeSingle();
    const policy = parseHouseholdPolicy(guardianRow?.household_policy);
    if (!policy) {
      return NextResponse.json({ error: 'Set your household defaults first.' }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: athletes } = await admin
      .from('profiles')
      .select('id, dob, jurisdiction')
      .in('id', targets.length > 0 ? targets : ['00000000-0000-0000-0000-000000000000']);
    const byId = new Map((athletes ?? []).map(a => [a.id, a]));

    const results = [];
    for (const profileId of targets) {
      const athlete = byId.get(profileId);
      const band = athlete?.dob ? ageBand(athlete.dob, athlete.jurisdiction, today) : 'younger';
      const presets = effectivePresets(policy, band);
      let result = await applySafetyPatch(admin, user.id, profileId, presets);
      let skipped: string[] | undefined;
      if (!result.ok && result.reason === 'consent_required') {
        // Consent gates only visibility→public — apply the rest.
        const { visibility: _dropped, ...rest } = presets;
        void _dropped;
        result = await applySafetyPatch(admin, user.id, profileId, rest);
        skipped = ['visibility'];
      }
      results.push(
        result.ok
          ? { profileId, ok: true as const, changed: result.changed, ...(skipped ? { skipped } : {}) }
          : { profileId, ok: false as const, reason: result.reason }
      );
    }

    return NextResponse.json({ results });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] household apply error:', error);
    return NextResponse.json({ error: 'Could not apply household defaults' }, { status: 500 });
  }
}
