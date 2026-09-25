import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  peekOrgClaimInvite,
  redeemOrgClaimInvite,
  restoreOrgClaimInvite,
} from '@/lib/orgs/org-claim';
import { insertOwnerRow } from '@/lib/orgs/members';
import { recordAuthority } from '@/lib/authority/audit-server';
import { redeemRecoveryLink } from '@/lib/authority/recovery-server';

import { reportRouteError } from '@/lib/observability/report';

// ── /api/org-claim/[token] — stub-org handover (phase 1 round 2) ────────────
// GET = unauthenticated peek (uniform {valid:false} 404s keep token
// guessing uninformative; the body never carries the invited email).
// POST = claim (the invites-claim peek-then-typed-redeem shape): the
// precondition check runs WITHOUT consuming; the atomic redeem is the
// double-claim authority; a failed post-redeem precondition RESTORES the
// invite — a token must never burn on a race it lost.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const limited = await enforceRateLimit(request, 'org-claim-peek');
    if (limited) return limited;
    const { token } = await params;
    if (!token || token.length < 20) {
      return NextResponse.json({ valid: false }, { status: 404 });
    }
    const peeked = await peekOrgClaimInvite(getSupabaseAdmin(), token);
    // Authority (240): a RECOVERY link adds an owner beside whoever is there,
    // so an owned org is fine; a handover link needs an ownerless one.
    const recovery = peeked?.purpose === 'recovery';
    if (!peeked || (!recovery && peeked.org.owner_profile_id)) {
      return NextResponse.json({ valid: false }, { status: 404 });
    }
    return NextResponse.json({
      valid: true,
      recovery,
      org: {
        side: peeked.org.side,
        name: peeked.org.name,
        sport: peeked.org.sport_key ?? null,
        city: peeked.org.city,
        region: peeked.org.region,
        country: peeked.org.country,
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG CLAIM] peek error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-claim', { userId: user.id });
    if (limited) return limited;
    const { token } = await params;
    if (!token || token.length < 20) {
      return NextResponse.json({ error: 'This link is not valid' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();

    // Peek first — preconditions checked WITHOUT consuming.
    const peeked = await peekOrgClaimInvite(admin, token);
    if (!peeked) {
      return NextResponse.json(
        { error: 'This link has expired or was already used.' },
        { status: 410 }
      );
    }
    // Authority (240): the recovery branch — its own rules (email-bound, adds an owner) in the lib.
    if (peeked.purpose === 'recovery') {
      const recovered = await redeemRecoveryLink(admin, token, user);
      if (!recovered.ok) return NextResponse.json({ error: recovered.error }, { status: recovered.status === 404 ? 410 : recovered.status });
      return NextResponse.json({ ok: true, side: recovered.side, orgId: recovered.orgId, recovery: true });
    }
    if (peeked.org.owner_profile_id) {
      return NextResponse.json(
        { error: 'This organization already has an owner.' },
        { status: 409 }
      );
    }

    // Atomic single-use redeem — the double-claim authority.
    const redeemed = await redeemOrgClaimInvite(admin, token, user.id);
    if (!redeemed) {
      return NextResponse.json(
        { error: 'This link has expired or was already used.' },
        { status: 410 }
      );
    }

    // Guarded owner fill: zero rows = an owner appeared inside the race
    // window → restore the invite (never burn a token on a lost race).
    const { data: filled, error: fillError } = await admin
      .from('organizations')
      .update({ owner_profile_id: user.id })
      .eq('id', redeemed.orgId)
      .is('owner_profile_id', null)
      .select('id');
    if (fillError || !filled || filled.length === 0) {
      if (fillError) reportRouteError('[ORG CLAIM] owner fill error:', fillError);
      await restoreOrgClaimInvite(admin, token);
      return NextResponse.json(
        { error: 'This organization already has an owner.' },
        { status: 409 }
      );
    }

    // The owner MEMBERSHIP row — rows are the authority (0.8). Failure
    // rolls the whole claim back (two-insert discipline).
    const { error: memberError } = await insertOwnerRow(
      admin,
      { side: redeemed.side, orgId: redeemed.orgId },
      user.id
    );
    if (memberError) {
      reportRouteError('[ORG CLAIM] owner row error:', memberError);
      await admin.from('organizations').update({ owner_profile_id: null }).eq('id', redeemed.orgId);
      await restoreOrgClaimInvite(admin, token);
      return NextResponse.json({ error: 'Could not complete the claim' }, { status: 500 });
    }

    await recordAuthority(admin, {
      subject: { type: 'org', id: redeemed.orgId },
      actor: { kind: 'member', profileId: user.id },
      action: 'owner_claimed', // the claimant is the actor — no separate target
    });
    return NextResponse.json({ ok: true, side: redeemed.side, orgId: redeemed.orgId });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ORG CLAIM] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
