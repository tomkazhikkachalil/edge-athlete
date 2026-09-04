import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import {
  grantStaffRow,
  peekStaffInvite,
  redeemStaffInvite,
  restoreStaffInvite,
  writeStaffAudit,
} from '@/lib/orgs/staff-invites';
import { notifyStaffAccepted } from '@/lib/orgs/staff-notify';
import { describeGrant } from '@/lib/orgs/staff-validate';

// ── /api/org-invite/[token] — accept a staff invite (org staff program) ─────
// GET = unauthenticated peek (uniform {valid:false} 404s keep token guessing
// uninformative; the body never carries the invited email). POST = accept:
// the org-claim peek-then-typed-redeem shape. Preconditions checked WITHOUT
// consuming: the signed-in account's email must match the invite (never
// silently bind a token to another person), and a supervised profile can
// never hold a staff row. The atomic redeem is the double-accept authority;
// a failed grant after redeem RESTORES the invite.

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const limited = await enforceRateLimit(request, 'staff-invite-peek');
    if (limited) return limited;
    const { token } = await params;
    if (!token || token.length < 20) return NextResponse.json({ valid: false }, { status: 404 });
    const peeked = await peekStaffInvite(getSupabaseAdmin(), token);
    if (!peeked) return NextResponse.json({ valid: false }, { status: 404 });
    return NextResponse.json({
      valid: true,
      org: { side: peeked.side, id: peeked.orgId, name: peeked.orgName },
      grant: { role: peeked.grant.role, sections: peeked.grant.sections, scopeType: peeked.grant.scopeType, scopeName: peeked.scopeName, seasonLabel: peeked.seasonLabel },
      summary: describeGrant(peeked.grant),
      expiresAt: peeked.expiresAt,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG INVITE] peek error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'staff-invite-redeem', { userId: user.id });
    if (limited) return limited;
    const { token } = await params;
    if (!token || token.length < 20) return NextResponse.json({ error: 'This link is not valid' }, { status: 404 });
    const admin = getSupabaseAdmin();

    const peeked = await peekStaffInvite(admin, token);
    if (!peeked) return NextResponse.json({ error: 'This link has expired or was already used.' }, { status: 410 });

    const { data: me } = await admin
      .from('profiles')
      .select('email, supervision_state, first_name, last_name, full_name, display_name')
      .eq('id', user.id)
      .maybeSingle();
    const myEmail = ((me?.email as string | null) ?? user.email ?? '').toLowerCase();
    if (!myEmail || myEmail !== peeked.invitedEmail) {
      // The token stays intact — the right account can still accept.
      return NextResponse.json(
        { error: 'This invite was sent to a different email address. Sign in with the account that uses it.', wrongAccount: true },
        { status: 403 }
      );
    }
    if (me?.supervision_state === 'supervised') {
      return NextResponse.json({ error: 'A supervised account cannot hold a staff role.' }, { status: 403 });
    }

    const redeemed = await redeemStaffInvite(admin, token, user.id);
    if (!redeemed) return NextResponse.json({ error: 'This link has expired or was already used.' }, { status: 410 });

    const granted = await grantStaffRow(admin, {
      side: peeked.side, orgId: peeked.orgId, profileId: user.id, grant: peeked.grant, grantedBy: user.id,
    });
    if (!granted) {
      await restoreStaffInvite(admin, token);
      return NextResponse.json({ error: 'Could not complete the invite' }, { status: 500 });
    }
    await writeStaffAudit(admin, {
      side: peeked.side, orgId: peeked.orgId, profileId: user.id, actorId: user.id, action: 'accepted',
      role: granted.role, scopeType: peeked.grant.scopeType, scopeId: peeked.grant.scopeId, seasonId: peeked.grant.seasonId,
      oldSections: granted.oldSections, newSections: granted.newSections,
    });
    const personName =
      [me?.first_name, me?.last_name].filter(Boolean).join(' ') || (me?.full_name as string | null) || (me?.display_name as string | null) || 'A new staff member';
    await notifyStaffAccepted(admin, {
      side: peeked.side, orgId: peeked.orgId, orgName: peeked.orgName, personName, summary: describeGrant(peeked.grant), exceptProfileId: user.id,
    });
    return NextResponse.json({ ok: true, side: peeked.side, orgId: peeked.orgId, orgName: peeked.orgName, summary: describeGrant(peeked.grant) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ORG INVITE] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
