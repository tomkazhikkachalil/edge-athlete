import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { stateFromAction } from '@/lib/consent';
import { getClientIp } from '@/lib/rate-limit';

// ── /api/admin/consent-reviews ────────────────────────────────────────────────
// Admin review queue for signed-form parental consent. Reviews are NEW
// append-only rows (review_approved / review_rejected) — never edits.
// Evidence is served via short-lived signed URLs from the private bucket.

export async function GET(request: NextRequest) {
  try {
    const admin_user = await requireAdmin(request);
    void admin_user;
    const admin = getSupabaseAdmin();

    const { data: rows, error } = await admin
      .from('consent_records')
      .select('id, profile_id, guardian_user_id, guardian_email_snapshot, action, method, policy_version, jurisdiction, threshold_age, evidence_path, created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    // Latest row per profile decides state; queue = profiles pending review.
    const latestByProfile = new Map<string, (typeof rows)[number]>();
    for (const row of rows ?? []) {
      if (row.profile_id && !latestByProfile.has(row.profile_id)) {
        latestByProfile.set(row.profile_id, row);
      }
    }
    const pending = [...latestByProfile.values()].filter(
      r => stateFromAction(r.action) === 'pending_review'
    );

    const items = await Promise.all(
      pending.map(async r => {
        const { data: athlete } = await admin
          .from('profiles')
          .select('display_name, handle, dob')
          .eq('id', r.profile_id!)
          .maybeSingle();
        let evidenceUrl: string | null = null;
        if (r.evidence_path) {
          const { data: signed } = await admin.storage
            .from('consent-evidence')
            .createSignedUrl(r.evidence_path, 600);
          evidenceUrl = signed?.signedUrl ?? null;
        }
        return {
          recordId: r.id,
          profileId: r.profile_id,
          athleteName: athlete?.display_name ?? 'Unknown',
          athleteHandle: athlete?.handle ?? null,
          guardianEmail: r.guardian_email_snapshot,
          method: r.method,
          policyVersion: r.policy_version,
          jurisdiction: r.jurisdiction,
          thresholdAge: r.threshold_age,
          submittedAt: r.created_at,
          evidenceUrl,
        };
      })
    );

    return NextResponse.json({ pending: items });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONSENT-REVIEW] list error:', error);
    return NextResponse.json({ error: 'Could not load review queue' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const reviewer = await requireAdmin(request);
    const admin = getSupabaseAdmin();
    const body = await request.json().catch(() => ({}));
    const profileId = typeof body.profileId === 'string' ? body.profileId : '';
    const decision = body.decision === 'approve' ? 'review_approved'
      : body.decision === 'reject' ? 'review_rejected' : null;
    if (!profileId || !decision) {
      return NextResponse.json({ error: 'profileId and decision (approve|reject) required' }, { status: 400 });
    }

    // Copy the audit snapshot forward from the granted row being reviewed.
    const { data: granted } = await admin
      .from('consent_records')
      .select('subject_dob_year, guardian_user_id, guardian_email_snapshot, method, policy_version, jurisdiction, threshold_age, evidence_path')
      .eq('profile_id', profileId)
      .eq('action', 'granted')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!granted) {
      return NextResponse.json({ error: 'No pending consent for this profile' }, { status: 404 });
    }

    const { error: insertError } = await admin.from('consent_records').insert({
      profile_id: profileId,
      subject_dob_year: granted.subject_dob_year,
      guardian_user_id: granted.guardian_user_id,
      guardian_email_snapshot: granted.guardian_email_snapshot,
      method: granted.method,
      action: decision,
      policy_version: granted.policy_version,
      jurisdiction: granted.jurisdiction,
      threshold_age: granted.threshold_age,
      evidence_path: granted.evidence_path,
      reviewed_by: reviewer.id,
      ip: getClientIp(request),
      user_agent: request.headers.get('user-agent'),
    });
    if (insertError) throw insertError;

    // Tell the guardians the review landed (best-effort). Approved unlocks
    // publishing and the go-public toggle; rejected sends them back to the
    // consent page.
    {
      const { notifyGuardians, profileFirstName } = await import('@/lib/guardian-notify');
      const childName = await profileFirstName(admin, profileId);
      await notifyGuardians(admin, profileId, {
        type: 'consent_result',
        title: decision === 'review_approved'
          ? `Consent approved — ${childName}'s profile can now publish`
          : `Consent for ${childName} was not approved`,
        actionUrl: decision === 'review_approved'
          ? `/app/guardian/athlete/${profileId}`
          : `/app/guardian/consent/${profileId}`,
        metadata: { decision },
      });
    }

    return NextResponse.json({ ok: true, state: stateFromAction(decision) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONSENT-REVIEW] decision error:', error);
    Sentry.captureException(error, { tags: { area: 'consent-review' } });
    return NextResponse.json({ error: 'Could not record the decision' }, { status: 500 });
  }
}
