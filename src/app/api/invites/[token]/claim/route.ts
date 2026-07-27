import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { redeemGuardianInvite } from '@/lib/guardian-invites';
import { FEATURE_FLAGS } from '@/lib/features';

// ── POST /api/invites/[token]/claim ───────────────────────────────────────────
// A logged-in guardian claims an athlete-initiated invite: atomically
// consumes the token and returns the parked athlete's basics so the
// Add-your-athlete screen can prefill. DECISION: the pending child_email is
// DISCARDED — the child has no email; the managed profile is created via
// /api/guardian/athletes with a synthetic identity. The pending row moves to
// consent_pending and is finalized (promoted_profile_id + approved) when the
// guardian actually creates the profile.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const { token } = await params;
    const admin = getSupabaseAdmin();

    const invite = await redeemGuardianInvite(admin, token);
    if (!invite || !invite.pending_profile_id) {
      return NextResponse.json(
        { error: 'This invite link is no longer valid. Ask your athlete to send a new request.' },
        { status: 410 }
      );
    }

    const { data: pending, error } = await admin
      .from('pending_profiles')
      .update({ state: 'consent_pending' })
      .eq('id', invite.pending_profile_id)
      .in('state', ['awaiting_guardian', 'consent_pending'])
      .select('id, payload, dob, jurisdiction, threshold_age')
      .maybeSingle();
    if (error || !pending) {
      return NextResponse.json(
        { error: 'This request has expired. Ask your athlete to send a new one.' },
        { status: 410 }
      );
    }

    const payload = (pending.payload ?? {}) as Record<string, unknown>;
    return NextResponse.json({
      ok: true,
      pendingProfileId: pending.id,
      athlete: {
        first_name: (payload.first_name as string) ?? '',
        last_name: (payload.last_name as string) ?? '',
        dob: pending.dob,
      },
      claimedBy: user.id,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[INVITES] claim error:', error);
    Sentry.captureException(error, { tags: { area: 'invite-claim' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
