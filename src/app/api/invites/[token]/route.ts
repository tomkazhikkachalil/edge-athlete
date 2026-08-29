import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { peekGuardianInvite } from '@/lib/guardian-invites';
import { enforceRateLimit } from '@/lib/rate-limit';
import { FEATURE_FLAGS } from '@/lib/features';

// ── GET /api/invites/[token] ──────────────────────────────────────────────────
// Peek (never consumes) a guardian invite so the landing page can render.
// Consumption happens later, atomically, inside the consent flow (Phase 3).
// Returns only what the page needs — never the pending payload itself.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }
  // Unauthenticated by design (a parent opens this before having an
  // account), and the valid response names the invited email + child's
  // first name — so token guessing must be expensive. The claim POST was
  // always limited; the peek wasn't.
  const limited = await enforceRateLimit(request, 'invite-peek');
  if (limited) return limited;
  const { token } = await params;
  if (!token || token.length < 20) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }

  const admin = getSupabaseAdmin();
  const invite = await peekGuardianInvite(admin, token);
  if (!invite) {
    return NextResponse.json({ valid: false }, { status: 404 });
  }

  let athleteFirstName: string | null = null;
  if (invite.pending_profile_id) {
    const { data: pending } = await admin
      .from('pending_profiles')
      .select('payload, state')
      .eq('id', invite.pending_profile_id)
      .maybeSingle();
    if (!pending || !['awaiting_guardian', 'consent_pending'].includes(pending.state)) {
      return NextResponse.json({ valid: false }, { status: 404 });
    }
    athleteFirstName =
      (pending.payload as Record<string, unknown>)?.first_name as string | null;
  } else if (invite.invite_type === 'guardian_additional' && invite.profile_id) {
    // Co-guardian invite: the target must still be a supervised profile.
    // (athlete_activation invites also carry profile_id but their profile
    // is 'self' post-transfer — they keep the default pass-through.)
    const { data: child } = await admin
      .from('profiles')
      .select('first_name, supervision_state')
      .eq('id', invite.profile_id)
      .maybeSingle();
    if (!child || child.supervision_state !== 'supervised') {
      return NextResponse.json({ valid: false }, { status: 404 });
    }
    athleteFirstName = child.first_name ?? null;
  }

  // Registered guardian = match, not collision: tell the page so the CTA
  // reads "log in" instead of "create an account".
  const { data: existingGuardian } = await admin
    .from('profiles')
    .select('id')
    .eq('email', invite.invited_email)
    .maybeSingle();

  return NextResponse.json({
    valid: true,
    inviteType: invite.invite_type,
    grantRole: invite.grant_role,
    invitedEmail: invite.invited_email,
    athleteFirstName,
    guardianHasAccount: !!existingGuardian,
  });
}
