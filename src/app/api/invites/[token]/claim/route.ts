import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { peekGuardianInvite, redeemGuardianInvite } from '@/lib/guardian-invites';
import { FEATURE_FLAGS } from '@/lib/features';
import { enforceRateLimit } from '@/lib/rate-limit';

// ── POST /api/invites/[token]/claim ───────────────────────────────────────────
// A logged-in guardian claims a guardian invite. Peek-then-typed-redeem:
// the branch is chosen WITHOUT consuming, every precondition is validated
// first, and each branch redeems with its own invite_type filter — so a
// failed precondition or a token of another kind (e.g. athlete_activation)
// is refused with the token intact, never burned.
//
// guardian_for_pending — athlete-initiated signup: consumes the token and
// returns the parked athlete's basics so Add-your-athlete can prefill.
// DECISION: the pending child_email is DISCARDED — the child has no email.
//
// guardian_additional — co-guardian / support takeover: grants the caller
// guardian access to an existing supervised profile via the
// grant_guardian_access RPC (which writes its own audit row).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'invite-claim', { userId: user.id });
    if (limited) return limited;

    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const { token } = await params;
    const admin = getSupabaseAdmin();

    const peeked = await peekGuardianInvite(admin, token);
    if (!peeked) {
      return NextResponse.json(
        { error: 'This invite link is no longer valid. Ask your athlete to send a new request.' },
        { status: 410 }
      );
    }

    if (peeked.invite_type === 'guardian_additional' && peeked.profile_id) {
      const childId = peeked.profile_id;
      const { data: child } = await admin
        .from('profiles')
        .select('id, first_name, supervision_state')
        .eq('id', childId)
        .maybeSingle();
      if (!child || child.supervision_state !== 'supervised') {
        return NextResponse.json(
          { error: 'This invite is no longer valid — the athlete profile has changed.' },
          { status: 410 }
        );
      }
      if (user.id === childId) {
        return NextResponse.json(
          { error: 'This invite is for a guardian, not the athlete.' },
          { status: 403 }
        );
      }
      const { data: guardianRows } = await admin
        .from('profile_access')
        .select('user_id')
        .eq('profile_id', childId)
        .eq('role', 'guardian');
      if ((guardianRows ?? []).some(g => g.user_id === user.id)) {
        return NextResponse.json(
          { error: 'You already manage this athlete.' },
          { status: 409 }
        );
      }
      if ((guardianRows ?? []).length >= 2) {
        return NextResponse.json(
          { error: 'This athlete already has two guardians.' },
          { status: 409 }
        );
      }

      const consumed = await redeemGuardianInvite(admin, token, 'guardian_additional');
      if (!consumed) {
        return NextResponse.json(
          { error: 'This invite link is no longer valid.' },
          { status: 410 }
        );
      }
      const { error: grantError } = await admin.rpc('grant_guardian_access', {
        p_profile: childId,
        p_new_guardian: user.id,
        p_actor: consumed.created_by ?? user.id,
      });
      if (grantError) {
        // Best-effort un-consume so the link can be retried (guardian_invites
        // has no immutability trigger).
        await admin
          .from('guardian_invites')
          .update({ consumed_at: null })
          .eq('id', consumed.id);
        Sentry.captureException(new Error(`invite claim: grant failed: ${grantError.message}`), {
          extra: { childId },
        });
        return NextResponse.json({ error: 'Could not grant access. Please try again.' }, { status: 500 });
      }
      // Tell the EXISTING guardian(s) a co-guardian joined (best-effort; the
      // new guardian is excluded — they just did it).
      {
        const { notifyGuardians } = await import('@/lib/guardian-notify');
        await notifyGuardians(admin, childId, {
          type: 'athlete_added',
          title: `A co-guardian now manages ${child.first_name ?? 'your athlete'} with you`,
          actionUrl: `/app/guardian/athlete/${childId}`,
          actorId: user.id,
        }, user.id);
      }
      return NextResponse.json({
        ok: true,
        granted: true,
        profileId: childId,
        athleteFirstName: child.first_name ?? null,
      });
    }

    if (peeked.invite_type !== 'guardian_for_pending') {
      // Activation/OTP tokens and anything unrecognized: refuse WITHOUT
      // consuming — those tokens belong to other endpoints.
      return NextResponse.json(
        { error: 'This invite link is no longer valid.' },
        { status: 410 }
      );
    }

    const invite = await redeemGuardianInvite(admin, token, 'guardian_for_pending');
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
