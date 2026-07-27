import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { peekGuardianInvite } from '@/lib/guardian-invites';
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
  }

  return NextResponse.json({
    valid: true,
    inviteType: invite.invite_type,
    invitedEmail: invite.invited_email,
    athleteFirstName,
  });
}
