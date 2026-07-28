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
    return NextResponse.json({ orphans });
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
        try {
          await emailService.sendCoGuardianInvite(email, profile.first_name ?? '', inviteUrl, appUrl);
          emailSent = true;
        } catch (e) {
          console.error('[ADMIN] co-guardian invite email failed:', e);
          Sentry.captureException(e, { tags: { area: 'guardian-support' } });
        }
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
