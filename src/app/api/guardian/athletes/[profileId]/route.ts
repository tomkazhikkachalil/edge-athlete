import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin, getProfileRole, requireProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { parkAccount, PARK_WINDOW_DAYS } from '@/lib/account-park';
import { getClientIp } from '@/lib/rate-limit';
import {
  COMMENT_MODERATION_VALUES,
  MESSAGING_VALUES,
  VISIBILITY_VALUES,
} from '@/lib/profile-privacy';

// ── PATCH /api/guardian/athletes/[profileId] ──────────────────────────────────
// Family console: a guardian adjusts a managed athlete's safety posture.
// Strict whitelist — visibility and messaging_permission only. PUT
// /api/profile is deliberately self-locked, so this is the ONLY route that
// lets a guardian change these after creation (which forces private/nobody).
//
// This is also the first real requireProfileRole call site: the permission
// matrix (profile-roles.ts) grants guardians 'manage_privacy', and this
// route enforces it rather than hand-rolling the role check.
//
// Every change writes a safety_settings_audit row (091): old→new value plus
// the acting guardian, appended best-effort in the PATCH below.
// (profile_access_audit stays scoped to access-ROLE changes.)

// Value whitelists come from profile-privacy.ts (Wave 4 collapse) — the one
// source the UI options, this route, and the household policy all share.

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params;
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const { user: actor } = await requireProfileRole(request, profileId, 'manage_privacy');

    const body = await request.json().catch(() => ({}));
    const update: Record<string, string> = {};
    if (body.visibility !== undefined) {
      if (!VISIBILITY_VALUES.includes(body.visibility)) {
        return NextResponse.json({ error: 'Invalid visibility value' }, { status: 400 });
      }
      update.visibility = body.visibility;
    }
    if (body.messaging_permission !== undefined) {
      if (!MESSAGING_VALUES.includes(body.messaging_permission)) {
        return NextResponse.json({ error: 'Invalid messaging permission value' }, { status: 400 });
      }
      update.messaging_permission = body.messaging_permission;
    }
    // Comment moderation (095): instant vs held-for-review. No consent gate —
    // unlike going public, tightening/relaxing moderation exposes nothing.
    if (body.comment_moderation !== undefined) {
      if (!COMMENT_MODERATION_VALUES.includes(body.comment_moderation)) {
        return NextResponse.json({ error: 'Invalid comment moderation value' }, { status: 400 });
      }
      update.comment_moderation = body.comment_moderation;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // Shared semantics (Wave 4): applySafetyPatch is the one code path that
    // changes a child's posture — this route, apply-to-all, and the
    // age-preset decision all use it. Reason→response mapping keeps this
    // route's contract byte-identical to pre-extraction.
    const admin = getSupabaseAdmin();
    const { applySafetyPatch } = await import('@/lib/safety-settings');
    const result = await applySafetyPatch(admin, actor.id, profileId, update);
    if (!result.ok) {
      if (result.reason === 'not_supervised') {
        return NextResponse.json({
          error: 'Only supervised athlete profiles can be managed here. Transferred accounts belong to their owner.'
        }, { status: 409 });
      }
      if (result.reason === 'consent_required') {
        return NextResponse.json({
          error: 'Complete the consent review before making this profile public.'
        }, { status: 403 });
      }
      return NextResponse.json({ error: 'Could not save the change. Please try again.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] patch athlete error:', error);
    Sentry.captureException(error, { tags: { area: 'guardian-athletes' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}

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
        ip: getClientIp(request),
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

    // PARK, don't destroy (Wave 1e, migration 128): 30-day window with a
    // restore action on the family console; the daily cron hard-deletes
    // after it. The withdrawn consent row above still records the decision;
    // a restore writes a fresh 'granted' row back through admin review.
    await parkAccount(admin, profileId, user.id);
    return NextResponse.json({ ok: true, parkWindowDays: PARK_WINDOW_DAYS });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] delete athlete error:', error);
    Sentry.captureException(error, { tags: { area: 'guardian-athletes' } });
    return NextResponse.json({ error: 'Could not delete the profile. Please try again.' }, { status: 500 });
  }
}
