import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { getConsentState, CONSENT_POLICY_VERSION } from '@/lib/consent';
import { getClientIp } from '@/lib/rate-limit';

// ── /api/guardian/athletes/[profileId]/consent ────────────────────────────────
// Signed-form parental consent (Phase 3b). GUARDIAN-ONLY — consent is a
// guardian act; owners/supervised/viewers are refused. Evidence lands in the
// PRIVATE consent-evidence bucket; the append-only consent_records row
// carries the full audit (method, policy version, jurisdiction snapshot,
// guardian identity + email snapshot, ip, user agent).

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
    const file = formData.get('evidence');
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Please attach the signed consent form.' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (10 MB max).' }, { status: 400 });
    }
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json({ error: 'Please upload a photo (JPG/PNG/WebP) or PDF.' }, { status: 400 });
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

    const { error: insertError } = await admin.from('consent_records').insert({
      profile_id: profileId,
      subject_dob_year: athlete?.dob ? new Date(athlete.dob).getUTCFullYear() : 0,
      guardian_user_id: user.id,
      guardian_email_snapshot: user.email ?? '',
      method: 'signed_form',
      action: 'granted',
      policy_version: CONSENT_POLICY_VERSION,
      jurisdiction: athlete?.jurisdiction ?? 'DEFAULT',
      threshold_age: athlete?.minor_threshold_age ?? 16,
      evidence_path: evidencePath,
      ip: getClientIp(request),
      user_agent: request.headers.get('user-agent'),
    });
    if (insertError) {
      Sentry.captureException(new Error(`consent: record insert failed: ${insertError.message}`));
      return NextResponse.json({ error: 'Could not record consent. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, state: 'pending_review' }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONSENT] error:', error);
    Sentry.captureException(error, { tags: { area: 'consent' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
