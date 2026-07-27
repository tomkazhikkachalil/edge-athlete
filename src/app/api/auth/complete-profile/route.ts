import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { mapProfileUpsertError } from '@/lib/signup-errors';
import { validateHandleFormat } from '@/lib/handle-validation';
import { deriveAvatarUrl, type OAuthMetadataLike } from '@/lib/oauth-profile';
import { FEATURE_FLAGS } from '@/lib/features';
import { isValidDateString, isNotFutureDate } from '@/lib/date-validation';
import {
  isUnderThreshold,
  jurisdictionFromHeaders,
  getMinorThreshold,
} from '@/lib/config/minors-config';
import { createGuardianInvite } from '@/lib/guardian-invites';
import { emailService } from '@/lib/email-service';

// ── POST /api/auth/complete-profile ───────────────────────────────────────────
// Creates the profiles row for a first-time OAuth user. The handle MUST be
// set here — update_user_handle() refuses NULL→value transitions, so there
// is no later path. Admin client required: profiles has no RLS INSERT
// policy. Unlike /api/signup there is NO auth-user rollback on failure —
// the OAuth identity is real; the page just shows the error and retries.
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const first_name = typeof body.first_name === 'string' ? body.first_name.trim() : '';
    const last_name = typeof body.last_name === 'string' ? body.last_name.trim() : '';
    const handle = typeof body.handle === 'string' ? body.handle.toLowerCase().trim() : '';

    // display_name has a not-empty check constraint — require a first name.
    if (!first_name) {
      return NextResponse.json({ error: 'Please enter your first name.' }, { status: 400 });
    }

    // ── DOB gate (guardian-profiles) — the OAuth choke point ────────────────
    // OAuth first-timers arrive with a session but no profile; this is the
    // only place their age can be checked. Under-threshold: NO profile row is
    // created — park in pending_profiles (with auth_user_id, since the OAuth
    // identity already exists) and invite the guardian. The client signs the
    // user out after a parked response.
    if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      const dob = typeof body.dob === 'string' ? body.dob : '';
      if (!dob || !isValidDateString(dob) || !isNotFutureDate(dob)) {
        return NextResponse.json(
          { error: 'Please enter a valid date of birth.' },
          { status: 400 }
        );
      }
      const jurisdiction = jurisdictionFromHeaders(
        request.headers.get('x-vercel-ip-country'),
        request.headers.get('x-vercel-ip-country-region')
      );
      const today = new Date().toISOString().slice(0, 10);
      if (isUnderThreshold(dob, jurisdiction, today)) {
        const guardianEmail =
          typeof body.guardianEmail === 'string' ? body.guardianEmail.trim() : '';
        if (!guardianEmail || !guardianEmail.includes('@')) {
          return NextResponse.json(
            { needsGuardian: true, error: 'A parent or guardian needs to set up this account. Please provide their email address.' },
            { status: 422 }
          );
        }
        if (user.email && guardianEmail.toLowerCase() === user.email.toLowerCase()) {
          return NextResponse.json(
            { needsGuardian: true, error: "The guardian's email must be different from the athlete's email." },
            { status: 422 }
          );
        }
        const { data: pending, error: pendingError } = await getSupabaseAdmin()
          .from('pending_profiles')
          .insert({
            payload: { first_name, last_name, handle },
            child_email: user.email?.toLowerCase() ?? null,
            dob,
            jurisdiction,
            threshold_age: getMinorThreshold(jurisdiction),
            auth_user_id: user.id,
          })
          .select('id')
          .single();
        if (pendingError || !pending) {
          Sentry.captureException(new Error(`complete-profile: parking failed: ${pendingError?.message}`));
          return NextResponse.json({ error: 'Could not save the request. Please try again.' }, { status: 500 });
        }
        const { data: existingGuardian } = await getSupabaseAdmin()
          .from('profiles')
          .select('id')
          .eq('email', guardianEmail.toLowerCase())
          .maybeSingle();
        const invite = await createGuardianInvite({
          admin: getSupabaseAdmin(),
          inviteType: 'guardian_for_pending',
          invitedEmail: guardianEmail,
          pendingProfileId: pending.id,
        });
        if (invite && process.env.SMTP_USER && process.env.SMTP_PASS) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
          try {
            await emailService.sendGuardianInvite(
              guardianEmail, first_name, `${appUrl}/invite/${invite.rawToken}`, appUrl, !!existingGuardian
            );
          } catch (mailError) {
            console.error('[OAUTH-PROFILE] guardian invite email failed:', mailError);
            Sentry.captureException(mailError, { tags: { area: 'guardian-invite' } });
          }
        }
        return NextResponse.json({
          parked: true,
          message: "Almost there! We've emailed your parent or guardian a link to finish setting up your profile.",
        });
      }
    }
    const formatResult = validateHandleFormat(handle);
    if (!formatResult.isValid) {
      return NextResponse.json(
        { error: formatResult.error || 'Invalid handle format.' },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();

    // Idempotency: double-submit / back-button after success.
    const { data: existing } = await admin
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ ok: true, already: true });
    }

    // profiles.email is UNIQUE — an unlinked OAuth identity sharing an email
    // with an existing password account cannot get a second profile.
    if (user.email) {
      const { data: emailOwner } = await admin
        .from('profiles')
        .select('id')
        .eq('email', user.email.toLowerCase())
        .neq('id', user.id)
        .maybeSingle();
      if (emailOwner) {
        return NextResponse.json(
          {
            error:
              'An account with this email already exists. Please sign in with your email and password instead.',
          },
          { status: 409 }
        );
      }
    }

    // Server-side availability check (the page's live check can race).
    const { data: availabilityRows, error: availabilityError } = await admin.rpc(
      'check_handle_availability',
      { input_handle: handle, current_profile_id: user.id }
    );
    if (availabilityError) {
      Sentry.captureException(availabilityError, { tags: { area: 'oauth-complete-profile' } });
      return NextResponse.json(
        { error: 'Could not verify handle availability. Please try again.' },
        { status: 500 }
      );
    }
    const availability = availabilityRows?.[0];
    if (!availability?.available) {
      return NextResponse.json(
        { error: availability?.reason || 'This handle is not available.' },
        { status: 409 }
      );
    }

    const fullName = [first_name, last_name].filter(Boolean).join(' ') || undefined;
    const meta = (user.user_metadata ?? {}) as OAuthMetadataLike;
    const { error: insertError } = await admin.from('profiles').insert({
      id: user.id,
      email: user.email ? user.email.toLowerCase() : null,
      first_name,
      last_name: last_name || null,
      user_type: 'athlete',
      full_name: fullName || null,
      handle,
      display_name: fullName || handle || 'Athlete',
      avatar_url: deriveAvatarUrl(meta),
    });

    if (insertError) {
      console.error('[OAUTH-PROFILE] insert failed:', insertError);
      Sentry.captureException(
        new Error(`oauth complete-profile: insert failed: ${insertError.message}`),
        { extra: { code: insertError.code, details: insertError.details, userId: user.id } }
      );
      const mapped = mapProfileUpsertError(insertError);
      return NextResponse.json({ error: mapped.error }, { status: mapped.status });
    }

    // Guardian-profiles invariant: every profile carries an access row
    // (048 backfilled existing profiles; new ones add theirs here).
    const { error: accessError } = await admin
      .from('profile_access')
      .upsert(
        { user_id: user.id, profile_id: user.id, role: 'owner', granted_by: user.id },
        { onConflict: 'user_id,profile_id' }
      );
    if (accessError) {
      console.error('[OAUTH-PROFILE] owner access row failed:', accessError);
      Sentry.captureException(
        new Error(`complete-profile: owner profile_access insert failed: ${accessError.message}`),
        { extra: { userId: user.id } }
      );
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[OAUTH-PROFILE] error:', error);
    Sentry.captureException(error, { tags: { area: 'oauth-complete-profile' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
