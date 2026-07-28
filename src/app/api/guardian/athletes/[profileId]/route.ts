import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { hardDeleteAccount } from '@/lib/account-deletion';

// ── DELETE /api/guardian/athletes/[profileId] ─────────────────────────────────
// Consent withdrawal: a guardian permanently deletes a managed supervised
// profile. Server-verified type-to-confirm (the child's handle; no password
// — OAuth guardians have none). The consent statement promises withdrawal
// ⇒ permanent deletion; a 'withdrawn' consent row and 'revoked' audit rows
// are written first (they survive the deletion by design — consent_records
// profile FK SET NULLs, profile_access_audit has no FKs).

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { profileId } = await params;
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const role = await getProfileRole(user.id, profileId);
    if (role !== 'guardian') {
      return NextResponse.json({ error: 'Guardian access required' }, { status: 403 });
    }

    const admin = getSupabaseAdmin();
    const { data: child } = await admin
      .from('profiles')
      .select('handle, first_name, supervision_state')
      .eq('id', profileId)
      .maybeSingle();
    if (!child || child.supervision_state !== 'supervised') {
      return NextResponse.json({
        error: 'Only supervised athlete profiles can be deleted here. Transferred accounts belong to their owner.'
      }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const confirm = typeof body.confirmHandle === 'string'
      ? body.confirmHandle.trim().toLowerCase().replace(/^@/, '') : '';
    const expected = (child.handle || child.first_name || '').trim().toLowerCase();
    if (!expected) {
      return NextResponse.json({
        error: 'This profile cannot be confirmed for deletion. Please contact support.'
      }, { status: 409 });
    }
    if (confirm !== expected) {
      return NextResponse.json({
        error: "The handle you typed doesn't match this athlete's handle."
      }, { status: 400 });
    }

    // Compliance writes BEFORE deletion — both best-effort: their absence
    // must never leave a half-deleted account behind.
    const { data: lastConsent } = await admin
      .from('consent_records')
      .select('subject_dob_year, method, policy_version, jurisdiction, threshold_age')
      .eq('profile_id', profileId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastConsent) {
      const { error: consentError } = await admin.from('consent_records').insert({
        profile_id: profileId,
        subject_dob_year: lastConsent.subject_dob_year,
        guardian_user_id: user.id,
        guardian_email_snapshot: user.email ?? '',
        method: lastConsent.method,
        action: 'withdrawn',
        policy_version: lastConsent.policy_version,
        jurisdiction: lastConsent.jurisdiction,
        threshold_age: lastConsent.threshold_age,
        ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        user_agent: request.headers.get('user-agent'),
      });
      if (consentError) {
        console.error('[GUARDIAN] withdrawn consent insert failed:', consentError);
        Sentry.captureException(new Error(`guardian delete: withdrawn row failed: ${consentError.message}`));
      }
    }

    const { data: guardianRows } = await admin
      .from('profile_access')
      .select('user_id')
      .eq('profile_id', profileId)
      .eq('role', 'guardian');
    if (guardianRows?.length) {
      const { error: auditError } = await admin.from('profile_access_audit').insert(
        guardianRows.map(g => ({
          profile_id: profileId,
          user_id: g.user_id,
          action: 'revoked',
          old_role: 'guardian',
          actor_id: user.id,
        }))
      );
      if (auditError) {
        console.error('[GUARDIAN] delete audit insert failed:', auditError);
      }
    }

    const { warnings } = await hardDeleteAccount(admin, profileId);
    return NextResponse.json({ ok: true, warnings: warnings.length ? warnings : undefined });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] delete athlete error:', error);
    Sentry.captureException(error, { tags: { area: 'guardian-athletes' } });
    return NextResponse.json({ error: 'Could not delete the profile. Please try again.' }, { status: 500 });
  }
}
