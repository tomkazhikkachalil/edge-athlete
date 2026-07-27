import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { mapProfileUpsertError } from '@/lib/signup-errors';
import { validateHandleFormat } from '@/lib/handle-validation';
import { deriveAvatarUrl, type OAuthMetadataLike } from '@/lib/oauth-profile';

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

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[OAUTH-PROFILE] error:', error);
    Sentry.captureException(error, { tags: { area: 'oauth-complete-profile' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
