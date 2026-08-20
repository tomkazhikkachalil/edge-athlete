import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { createGuardianInvite } from '@/lib/guardian-invites';
import { getConsentState } from '@/lib/consent';
import { hardDeleteAccount } from '@/lib/account-deletion';
import { emailService } from '@/lib/email-service';

// ── /api/admin/guardian-support ───────────────────────────────────────────────
// Support tooling for orphaned supervised profiles (supervised, but zero
// guardians — e.g. after a co-guardian pair both deleted their accounts, or
// historical states). GET lists them; POST either invites a new guardian
// (guardian_additional token; the claim flow grants access) or hard-deletes
// the profile. Not flag-gated, matching the other admin routes — with the
// feature off the orphan list is simply empty.

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = getSupabaseAdmin();

    const { data: supervised } = await admin
      .from('profiles')
      .select('id, first_name, last_name, full_name, handle, created_at')
      .eq('supervision_state', 'supervised');
    if (!supervised?.length) return NextResponse.json({ orphans: [] });

    const ids = supervised.map(p => p.id);
    const { data: accessRows } = await admin
      .from('profile_access')
      .select('profile_id, role')
      .in('profile_id', ids)
      .in('role', ['guardian', 'supervised']);

    const guardians = new Set<string>();
    const selfRows = new Set<string>();
    for (const row of accessRows ?? []) {
      if (row.role === 'guardian') guardians.add(row.profile_id);
      else selfRows.add(row.profile_id);
    }

    const orphanProfiles = supervised.filter(p => !guardians.has(p.id));
    const orphans = await Promise.all(
      orphanProfiles.map(async p => ({
        id: p.id,
        name: [p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || p.handle || p.id,
        handle: p.handle,
        createdAt: p.created_at,
        hasCredentials: selfRows.has(p.id),
        consentState: await getConsentState(admin, p.id),
      }))
    );

    // Parked minor sign-ups (funnel round): pending_profiles rows have NO
    // profile, so they were invisible to every admin surface — and the raw
    // invite token exists only in the (possibly failed) email. Listing
    // them + the re-mint action below is the rescue path.
    const { data: parkedRows } = await admin
      .from('pending_profiles')
      .select('id, payload, child_email, dob, created_at, expires_at')
      .eq('state', 'awaiting_guardian')
      .order('created_at', { ascending: false });
    let parked: Array<Record<string, unknown>> = [];
    if (parkedRows?.length) {
      const { data: inviteRows } = await admin
        .from('guardian_invites')
        .select('pending_profile_id, invited_email, expires_at, consumed_at, created_at')
        .in('pending_profile_id', parkedRows.map(r => r.id))
        .order('created_at', { ascending: false });
      const latestInvite = new Map<string, { invited_email: string; expires_at: string; consumed_at: string | null }>();
      for (const inv of inviteRows ?? []) {
        if (inv.pending_profile_id && !latestInvite.has(inv.pending_profile_id)) {
          latestInvite.set(inv.pending_profile_id, inv);
        }
      }
      parked = parkedRows.map(r => {
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        const inv = latestInvite.get(r.id);
        return {
          id: r.id,
          name: [payload.first_name, payload.last_name].filter(Boolean).join(' ') || 'Unknown',
          childEmail: r.child_email,
          dob: r.dob,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          invitedEmail: inv?.invited_email ?? null,
          inviteExpired: inv ? (!!inv.consumed_at || new Date(inv.expires_at) < new Date()) : true,
        };
      });
    }

    return NextResponse.json({ orphans, parked });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN] guardian-support list error:', error);
    return NextResponse.json({ error: 'Could not load orphaned profiles' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const adminUser = await requireAdmin(request);
    const admin = getSupabaseAdmin();
    const body = await request.json().catch(() => ({}));
    const action = body.action as string;
    const profileId = typeof body.profileId === 'string' ? body.profileId : '';

    // ── remint_invite: rescue a parked minor sign-up ─────────────────────────
    // Parked rows have NO profile, so this branches BEFORE the profile
    // lookup. Expires prior unconsumed invites (the signup re-submit
    // pattern), mints a fresh token, and returns the URL to the admin — NO
    // email attempt: the admin shares the link directly (owner decision).
    if (action === 'remint_invite') {
      const pendingProfileId = typeof body.pendingProfileId === 'string' ? body.pendingProfileId : '';
      const emailOverride = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const { data: pending } = await admin
        .from('pending_profiles')
        .select('id, state, child_email, payload')
        .eq('id', pendingProfileId)
        .maybeSingle();
      if (!pending || pending.state !== 'awaiting_guardian') {
        return NextResponse.json({ error: 'No parked sign-up found for that id.' }, { status: 404 });
      }
      const { data: priorInvite } = await admin
        .from('guardian_invites')
        .select('invited_email')
        .eq('pending_profile_id', pending.id)
        .is('consumed_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const invitedEmail = emailOverride || priorInvite?.invited_email;
      if (!invitedEmail || !invitedEmail.includes('@')) {
        return NextResponse.json({ error: 'No guardian email on record — pass one explicitly.' }, { status: 400 });
      }
      // House pattern (signup re-submit): expire, don't mark consumed —
      // these invites were never used.
      await admin
        .from('guardian_invites')
        .update({ expires_at: new Date().toISOString() })
        .eq('pending_profile_id', pending.id)
        .is('consumed_at', null);
      const invite = await createGuardianInvite({
        admin,
        inviteType: 'guardian_for_pending',
        invitedEmail,
        pendingProfileId: pending.id,
        createdBy: adminUser.id,
      });
      if (!invite) {
        return NextResponse.json({ error: 'Could not create the invite.' }, { status: 500 });
      }
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
      return NextResponse.json({ ok: true, inviteUrl: `${appUrl}/invite/${invite.rawToken}`, invitedEmail });
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('id, first_name, supervision_state')
      .eq('id', profileId)
      .maybeSingle();
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    if (profile.supervision_state !== 'supervised') {
      return NextResponse.json(
        { error: 'Only supervised profiles can be managed here.' },
        { status: 409 }
      );
    }

    // ── reissue_transfer_otp: rescue a transfer stuck at contact verify ──────
    // The OTP is emailed and only its hash is stored; when sends fail the
    // athlete can never advance. Re-issue and return the PLAINTEXT code to
    // the admin to read out (15-min expiry, single-use; accepted risk —
    // authenticated admin, Sentry breadcrumb for audit).
    if (action === 'reissue_transfer_otp') {
      const { data: transfer } = await admin
        .from('profile_transfers')
        .select('id, state, athlete_contact_email')
        .eq('profile_id', profileId)
        .eq('state', 'credentials_pending')
        .maybeSingle();
      if (!transfer || !transfer.athlete_contact_email) {
        return NextResponse.json(
          { error: 'No transfer awaiting contact verification for this profile.' },
          { status: 404 }
        );
      }
      const { issueContactOtp } = await import('@/lib/transfers');
      const code = await issueContactOtp(admin, transfer.id, profileId, transfer.athlete_contact_email);
      Sentry.addBreadcrumb({
        category: 'guardian-support',
        message: `admin ${adminUser.id} reissued transfer OTP for profile ${profileId}`,
        level: 'info',
      });
      return NextResponse.json({ ok: true, code, email: transfer.athlete_contact_email });
    }

    if (action === 'invite_guardian') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'Please enter a valid email.' }, { status: 400 });
      }
      const invite = await createGuardianInvite({
        admin,
        inviteType: 'guardian_additional',
        invitedEmail: email,
        profileId,
        createdBy: adminUser.id,
      });
      if (!invite) {
        return NextResponse.json({ error: 'Could not create the invite.' }, { status: 500 });
      }
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
      const inviteUrl = `${appUrl}/invite/${invite.rawToken}`;
      // Best-effort email; the returned URL is the reliable channel (admin
      // can pass it along manually when SMTP is off).
      let emailSent = false;
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        // deliver() catches + Sentry-tags internally and returns the truth.
        emailSent = await emailService.sendCoGuardianInvite(email, profile.first_name ?? '', inviteUrl, appUrl);
      }
      return NextResponse.json({ ok: true, inviteUrl, emailSent });
    }

    if (action === 'delete_profile') {
      // Audit any remaining guardian rows (usually none for a true orphan).
      const { data: guardianRows } = await admin
        .from('profile_access')
        .select('user_id')
        .eq('profile_id', profileId)
        .eq('role', 'guardian');
      if (guardianRows?.length) {
        await admin.from('profile_access_audit').insert(
          guardianRows.map(g => ({
            profile_id: profileId,
            user_id: g.user_id,
            action: 'revoked',
            old_role: 'guardian',
            actor_id: adminUser.id,
          }))
        );
      }
      const { warnings } = await hardDeleteAccount(admin, profileId);
      return NextResponse.json({ ok: true, warnings: warnings.length ? warnings : undefined });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN] guardian-support action error:', error);
    Sentry.captureException(error, { tags: { area: 'guardian-support' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
