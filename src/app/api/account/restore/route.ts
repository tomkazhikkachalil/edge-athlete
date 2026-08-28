import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { restoreAccount } from '@/lib/account-park';
import { getClientIp } from '@/lib/rate-limit';

/**
 * POST /api/account/restore — cancel a pending (parked) deletion.
 *
 * Self: no body needed — clears the caller's own park stamp (the banner the
 * owner sees on signing back in during the 30-day window).
 * Guardian: { targetProfileId } — restores a parked managed athlete from the
 * family console. The park wrote a 'withdrawn' consent row, so a child
 * restore also writes a fresh 'granted' row (append-only) and consent goes
 * back through admin review before anything can publish again.
 *
 * Visibility stays private after restore — un-parking must never silently
 * re-publish a profile.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const admin = getSupabaseAdmin();
    const body = await request.json().catch(() => ({}));
    const rawTarget = typeof body.targetProfileId === 'string' ? body.targetProfileId : null;
    const targetId = rawTarget && rawTarget !== user.id ? rawTarget : user.id;

    if (targetId !== user.id) {
      const role = await getProfileRole(user.id, targetId);
      if (role !== 'guardian') {
        return NextResponse.json({ error: 'Guardian access required' }, { status: 403 });
      }
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('id, deletion_requested_at, supervision_state, dob')
      .eq('id', targetId)
      .maybeSingle();
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    if (!profile.deletion_requested_at) {
      return NextResponse.json({ error: 'This account is not scheduled for deletion' }, { status: 400 });
    }

    await restoreAccount(admin, targetId);

    // Child restore: consent was withdrawn at park time — append a fresh
    // 'granted' row (copying the last snapshot) so the account re-enters the
    // admin review queue instead of resurrecting approved consent silently.
    if (targetId !== user.id && profile.supervision_state === 'supervised') {
      const { data: lastConsent } = await admin
        .from('consent_records')
        .select('subject_dob_year, method, policy_version, jurisdiction, threshold_age')
        .eq('profile_id', targetId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastConsent) {
        const { error: consentError } = await admin.from('consent_records').insert({
          profile_id: targetId,
          subject_dob_year: lastConsent.subject_dob_year,
          guardian_user_id: user.id,
          guardian_email_snapshot: user.email ?? '',
          method: lastConsent.method,
          action: 'granted',
          policy_version: lastConsent.policy_version,
          jurisdiction: lastConsent.jurisdiction,
          threshold_age: lastConsent.threshold_age,
          ip: getClientIp(request),
          user_agent: request.headers.get('user-agent'),
        });
        if (consentError) {
          // Best-effort: the restore itself stands; consent can be re-signed
          // from the console's consent page.
          console.error('[RESTORE] granted consent insert failed:', consentError);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[RESTORE] error:', error);
    return NextResponse.json({ error: 'Could not restore the account' }, { status: 500 });
  }
}
