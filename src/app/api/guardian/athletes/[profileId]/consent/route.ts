import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { getConsentState, parseConsentMethod, CONSENT_POLICY_VERSION } from '@/lib/consent';
import { getClientIp } from '@/lib/rate-limit';

// ── /api/guardian/athletes/[profileId]/consent ────────────────────────────────
// Parental consent submission. GUARDIAN-ONLY — consent is a guardian act;
// owners/supervised/viewers are refused. Evidence lands in the PRIVATE
// consent-evidence bucket; the append-only consent_records rows carry the
// full audit (method, policy version, jurisdiction snapshot, guardian
// identity + email snapshot, ip, user agent).
//
// AUTO-APPROVE (Wave 6, Tom's call): every method approves at submission —
// the `granted` row is immediately followed by a `review_approved` row with
// reviewed_by NULL (null = system; admin rows carry the admin's id). The
// admin /dashboard/consent queue remains the after-the-fact audit surface,
// and its retro-reject still appends review_rejected and downgrades state.
// If the second insert fails the record stays pending_review and lands in
// the admin queue — the pre-Wave-6 path, so degradation is safe.

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export async function GET(
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
    const state = await getConsentState(getSupabaseAdmin(), profileId);
    return NextResponse.json({ state, policyVersion: CONSENT_POLICY_VERSION });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Could not load consent state' }, { status: 500 });
  }
}

export async function POST(
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

    const current = await getConsentState(admin, profileId);
    if (current === 'pending_review' || current === 'approved') {
      return NextResponse.json({ ok: true, state: current, already: true });
    }

    const formData = await request.formData();
    // Wave 3 (mig 130): the page offers three signature methods. typed/drawn
    // arrive as a client-rendered signature-card PNG in the SAME evidence
    // field — one review path for every method. Absent field = the pre-Wave-3
    // client → signed_form.
    const rawMethod = formData.get('method');
    const method = parseConsentMethod(typeof rawMethod === 'string' ? rawMethod : 'signed_form');
    if (!method) {
      return NextResponse.json({ error: 'Unknown consent method.' }, { status: 400 });
    }
    const file = formData.get('evidence');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: method === 'signed_form' ? 'Please attach the signed consent form.' : 'Please add your signature.' },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (10 MB max).' }, { status: 400 });
    }
    if (!ALLOWED.has(file.type) || (method !== 'signed_form' && file.type !== 'image/png')) {
      return NextResponse.json(
        { error: method === 'signed_form' ? 'Please upload a photo (JPG/PNG/WebP) or PDF.' : 'Signature must be a PNG image.' },
        { status: 400 }
      );
    }

    const ext = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1];
    const evidencePath = `${profileId}/${Date.now()}.${ext}`;
    const { error: uploadError } = await admin.storage
      .from('consent-evidence')
      .upload(evidencePath, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError) {
      Sentry.captureException(new Error(`consent: evidence upload failed: ${uploadError.message}`));
      return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 });
    }

    const { data: athlete } = await admin
      .from('profiles')
      .select('dob, jurisdiction, minor_threshold_age')
      .eq('id', profileId)
      .maybeSingle();

    const snapshot = {
      profile_id: profileId,
      subject_dob_year: athlete?.dob ? new Date(athlete.dob).getUTCFullYear() : 0,
      guardian_user_id: user.id,
      guardian_email_snapshot: user.email ?? '',
      method,
      policy_version: CONSENT_POLICY_VERSION,
      jurisdiction: athlete?.jurisdiction ?? 'DEFAULT',
      threshold_age: athlete?.minor_threshold_age ?? 16,
      evidence_path: evidencePath,
      ip: getClientIp(request),
      user_agent: request.headers.get('user-agent'),
    };

    const { error: insertError } = await admin.from('consent_records').insert({
      ...snapshot,
      action: 'granted',
    });
    if (insertError) {
      Sentry.captureException(new Error(`consent: record insert failed: ${insertError.message}`));
      return NextResponse.json({ error: 'Could not record consent. Please try again.' }, { status: 500 });
    }

    // Auto-approve: a second awaited append-only row, never an edit. A
    // failure here leaves the submission pending_review for the admin queue.
    const { error: approveError } = await admin.from('consent_records').insert({
      ...snapshot,
      action: 'review_approved',
      reviewed_by: null,
    });
    if (approveError) {
      Sentry.captureException(new Error(`consent: auto-approve insert failed: ${approveError.message}`));
      return NextResponse.json({ ok: true, state: 'pending_review' }, { status: 201 });
    }

    // Same notification the admin approve path sends — approved unlocks
    // publishing and the go-public toggle (best-effort; consent_result also
    // rides the urgent email tier, so a consent recorded by a co-guardian
    // reaches the other guardian's inbox within minutes).
    try {
      const { notifyGuardians, profileFirstName } = await import('@/lib/guardian-notify');
      const childName = await profileFirstName(admin, profileId);
      await notifyGuardians(admin, profileId, {
        type: 'consent_result',
        title: `Consent approved — ${childName}'s profile can now publish`,
        actionUrl: `/app/guardian/athlete/${profileId}`,
        metadata: { decision: 'review_approved', auto: true },
      });
    } catch (notifyError) {
      Sentry.captureException(notifyError, { tags: { area: 'consent' } });
    }

    return NextResponse.json({ ok: true, state: 'approved' }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONSENT] error:', error);
    Sentry.captureException(error, { tags: { area: 'consent' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
