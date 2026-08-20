import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireProfileRole, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { createGuardianInvite } from '@/lib/guardian-invites';
import { emailService } from '@/lib/email-service';

// ── /api/guardian/athletes/[profileId]/guardians ──────────────────────────────
// The co-guardian lifecycle, guardian-facing (previously admin-only): list
// the custody links + pending invites, invite a co-guardian, revoke one,
// cancel a pending invite. Gated on the permission matrix's 'manage_access'
// (its second-ever real call site).
//
// INVARIANT (profile-roles.ts documents it): a supervised profile must never
// drop to zero guardians. The DB backstop is partial — with a credentials
// self-row the delete would succeed and orphan the child — so the route
// blocks removing the last guardian outright.
//
// The claim side needs nothing: /api/invites/[token]/claim already validates
// (supervised, not-self, not-already-guardian, cap<2), grants via RPC, and
// notifies athlete_added. Multiple pending invites are safe — the ≤2 cap is
// re-checked at claim time.

async function requireSupervised(profileId: string) {
  const admin = getSupabaseAdmin();
  const { data: child } = await admin
    .from('profiles')
    .select('id, first_name, supervision_state')
    .eq('id', profileId)
    .maybeSingle();
  if (!child || child.supervision_state !== 'supervised') {
    throw new Response(
      JSON.stringify({ error: 'Only supervised athlete profiles can be managed here. Transferred accounts belong to their owner.' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
    );
  }
  return { admin, child };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params;
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    await requireProfileRole(request, profileId, 'manage_access');
    const { admin } = await requireSupervised(profileId);

    const [guardiansQ, invitesQ] = await Promise.all([
      admin
        .from('profile_access')
        .select('user_id, granted_at, profiles!profile_access_user_id_fkey(id, first_name, last_name, full_name, avatar_url)')
        .eq('profile_id', profileId)
        .eq('role', 'guardian')
        .order('granted_at', { ascending: true }),
      admin
        .from('guardian_invites')
        .select('id, invited_email, expires_at')
        .eq('profile_id', profileId)
        .eq('invite_type', 'guardian_additional')
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: true }),
    ]);

    return NextResponse.json({
      guardians: (guardiansQ.data ?? []).map(r => {
        const p = r.profiles as unknown as {
          id: string; first_name: string | null; last_name: string | null;
          full_name: string | null; avatar_url: string | null;
        };
        return {
          user_id: r.user_id,
          first_name: p?.first_name ?? null,
          last_name: p?.last_name ?? null,
          full_name: p?.full_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          since: r.granted_at,
        };
      }),
      pendingInvites: invitesQ.data ?? [],
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CO-GUARDIANS] list error:', error);
    return NextResponse.json({ error: 'Could not load guardians' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params;
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const { user } = await requireProfileRole(request, profileId, 'manage_access');
    const { admin, child } = await requireSupervised(profileId);

    const body = await request.json().catch(() => ({}));
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email.' }, { status: 400 });
    }

    const { data: guardianRows } = await admin
      .from('profile_access')
      .select('user_id')
      .eq('profile_id', profileId)
      .eq('role', 'guardian');
    if ((guardianRows ?? []).length >= 2) {
      return NextResponse.json(
        { error: 'This athlete already has two guardians.' },
        { status: 409 }
      );
    }

    const invite = await createGuardianInvite({
      admin,
      inviteType: 'guardian_additional',
      invitedEmail: email,
      profileId,
      createdBy: user.id,
    });
    if (!invite) {
      return NextResponse.json({ error: 'Could not create the invite.' }, { status: 500 });
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
    const inviteUrl = `${appUrl}/invite/${invite.rawToken}`;
    // Best-effort email; the returned URL is the reliable channel (the
    // guardian can share it manually when SMTP is off) — admin precedent.
    let emailSent = false;
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await emailService.sendCoGuardianInvite(email, child.first_name ?? '', inviteUrl, appUrl);
        emailSent = true;
      } catch (e) {
        console.error('[CO-GUARDIANS] invite email failed:', e);
        Sentry.captureException(e, { tags: { area: 'co-guardians' } });
      }
    }
    return NextResponse.json({ ok: true, inviteUrl, emailSent });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CO-GUARDIANS] invite error:', error);
    Sentry.captureException(error, { tags: { area: 'co-guardians' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params;
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const { user } = await requireProfileRole(request, profileId, 'manage_access');
    const { admin } = await requireSupervised(profileId);

    const body = await request.json().catch(() => ({}));

    // Cancel a pending invite: expire it (no deletes on guardian_invites —
    // the signup route's idiom).
    if (typeof body.inviteId === 'string' && body.inviteId) {
      const { data: expired } = await admin
        .from('guardian_invites')
        .update({ expires_at: new Date().toISOString() })
        .eq('id', body.inviteId)
        .eq('profile_id', profileId)
        .eq('invite_type', 'guardian_additional')
        .is('consumed_at', null)
        .select('id');
      if (!expired?.length) {
        return NextResponse.json({ error: 'This invite is no longer pending.' }, { status: 404 });
      }
      return NextResponse.json({ ok: true });
    }

    // Revoke a guardian.
    const guardianUserId =
      typeof body.guardianUserId === 'string' ? body.guardianUserId : '';
    if (!guardianUserId) {
      return NextResponse.json({ error: 'guardianUserId or inviteId required' }, { status: 400 });
    }

    const { data: guardianRows } = await admin
      .from('profile_access')
      .select('user_id')
      .eq('profile_id', profileId)
      .eq('role', 'guardian');
    const rows = guardianRows ?? [];
    if (!rows.some(g => g.user_id === guardianUserId)) {
      return NextResponse.json({ error: 'That person is not a guardian of this athlete.' }, { status: 404 });
    }
    if (rows.length <= 1) {
      return NextResponse.json({
        error: 'A supervised profile must always have a guardian. Invite a co-guardian first, or withdraw consent to delete the profile.'
      }, { status: 409 });
    }

    // Audit BEFORE the delete (append-only, no FKs — survives everything).
    const { error: auditError } = await admin.from('profile_access_audit').insert({
      profile_id: profileId,
      user_id: guardianUserId,
      action: 'revoked',
      old_role: 'guardian',
      actor_id: user.id,
    });
    if (auditError) {
      console.error('[CO-GUARDIANS] revoke audit insert failed:', auditError);
    }

    const { error: deleteError, count } = await admin
      .from('profile_access')
      .delete({ count: 'exact' })
      .eq('profile_id', profileId)
      .eq('user_id', guardianUserId)
      .eq('role', 'guardian');
    if (deleteError || !count) {
      console.error('[CO-GUARDIANS] revoke delete failed:', deleteError);
      return NextResponse.json({ error: 'Could not remove the guardian. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CO-GUARDIANS] revoke error:', error);
    Sentry.captureException(error, { tags: { area: 'co-guardians' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
