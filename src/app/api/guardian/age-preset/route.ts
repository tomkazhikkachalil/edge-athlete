import { NextRequest, NextResponse } from 'next/server';
import { requireProfileRole, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { UUID_RE } from '@/lib/uuid';
import { agePresetChanges, parseHouseholdPolicy } from '@/lib/household-policy';
import { applySafetyPatch, type SafetyPatch } from '@/lib/safety-settings';

// ── POST /api/guardian/age-preset ────────────────────────────────────────────
// The guardian's decision on an age-crossing prompt (Wave 4, mig 133).
// Dedicated endpoint so the settings application and the one-shot stamp ride
// the SAME request — no partial states. Apply recomputes the changes against
// the child's CURRENT settings (they may have moved since the sweep) and
// routes through the shared applySafetyPatch (consent gate, audit rows).
// The stamp is guarded on 'pending' — idempotent, first decision wins
// (per-child by design; the co-guardian sees the outcome in the feed).

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const transferId =
      typeof body.transferId === 'string' && UUID_RE.test(body.transferId) ? body.transferId : null;
    const decision = body.decision === 'apply' || body.decision === 'keep' ? body.decision : null;
    if (!transferId || !decision) {
      return NextResponse.json(
        { error: "transferId and decision ('apply'|'keep') are required" },
        { status: 400 }
      );
    }
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }

    const admin = getSupabaseAdmin();
    const { data: transfer } = await admin
      .from('profile_transfers')
      .select('id, profile_id, state, age_preset_prompt')
      .eq('id', transferId)
      .maybeSingle();
    if (!transfer) {
      return NextResponse.json({ error: 'Prompt not found' }, { status: 404 });
    }
    const { user } = await requireProfileRole(request, transfer.profile_id, 'manage_privacy');

    if (transfer.age_preset_prompt !== 'pending') {
      return NextResponse.json({ error: 'This prompt has already been decided' }, { status: 400 });
    }

    if (decision === 'keep') {
      await admin
        .from('profile_transfers')
        .update({ age_preset_prompt: 'kept' })
        .eq('id', transferId)
        .eq('age_preset_prompt', 'pending');
      return NextResponse.json({ ok: true, decision: 'kept' });
    }

    // Apply: MY older overrides, recomputed against current settings.
    const [{ data: guardianRow }, { data: child }] = await Promise.all([
      admin.from('profiles').select('household_policy').eq('id', user.id).maybeSingle(),
      admin
        .from('profiles')
        .select('visibility, messaging_permission, comment_moderation')
        .eq('id', transfer.profile_id)
        .maybeSingle(),
    ]);
    const policy = parseHouseholdPolicy(guardianRow?.household_policy);
    const changes = child ? agePresetChanges(child, policy) : [];
    if (changes.length === 0) {
      // Nothing left to change — settings already match. Stamp and finish.
      await admin
        .from('profile_transfers')
        .update({ age_preset_prompt: 'applied' })
        .eq('id', transferId)
        .eq('age_preset_prompt', 'pending');
      return NextResponse.json({ ok: true, decision: 'applied', changed: [] });
    }

    const patch = Object.fromEntries(changes.map(c => [c.field, c.to])) as SafetyPatch;
    let result = await applySafetyPatch(admin, user.id, transfer.profile_id, patch);
    let skipped: string[] | undefined;
    if (!result.ok && result.reason === 'consent_required') {
      const { visibility: _dropped, ...rest } = patch;
      void _dropped;
      result = await applySafetyPatch(admin, user.id, transfer.profile_id, rest);
      skipped = ['visibility'];
    }
    if (!result.ok) {
      return NextResponse.json({ error: 'Could not apply the settings' }, { status: 500 });
    }

    await admin
      .from('profile_transfers')
      .update({ age_preset_prompt: 'applied' })
      .eq('id', transferId)
      .eq('age_preset_prompt', 'pending');
    return NextResponse.json({
      ok: true,
      decision: 'applied',
      changed: result.changed,
      ...(skipped ? { skipped } : {}),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] age-preset decision error:', error);
    return NextResponse.json({ error: 'Could not record the decision' }, { status: 500 });
  }
}
