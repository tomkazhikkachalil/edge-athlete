import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { validateHandleFormat } from '@/lib/handle-validation';
import { isValidDateString, isNotFutureDate } from '@/lib/date-validation';
import {
  makeSyntheticEmail,
  getMinorThreshold,
  jurisdictionFromHeaders,
} from '@/lib/config/minors-config';
import { randomBytes } from 'crypto';
import { validateSupervisedHandle } from '@/lib/supervised-credentials';
import { buildAthleteSummaries } from '@/lib/guardian-rollup';
import { ACTIVE_TRANSFER_STATES } from '@/lib/transfers';
import { enforceRateLimit } from '@/lib/rate-limit';

// ── /api/guardian/athletes ────────────────────────────────────────────────────
// Step B: a guardian creates (and lists) managed athlete profiles.
//
// DECISION (guardian-profiles spec): the child has NO email — the form never
// asks for one. The shadow auth user carries a synthetic never-routable
// address (<profileId>@minors.invalid) and an unknown random password; the
// child gets no login surface until the guardian issues username credentials
// (Phase 4). The parent↔child relationship lives EXCLUSIVELY on
// profile_access (guardian rows) — the child row holds no parent pointer.

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ athletes: [] });
    }
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('profile_access')
      .select('granted_at, profiles!profile_access_profile_id_fkey(id, first_name, last_name, display_name, handle, avatar_url, dob, supervision_state, visibility, messaging_permission, comment_moderation)')
      .eq('user_id', user.id)
      .eq('role', 'guardian')
      .order('granted_at', { ascending: true });
    if (error) throw error;

    const athletes = (data ?? []).map(r => r.profiles as unknown as { id: string });
    const ids = athletes.map(a => a.id);

    // Console rollup: four batched IN-queries — constant query count however
    // many athletes a guardian manages (the transfers page used to fan out
    // one /api/transfers call per athlete instead).
    if (ids.length === 0) {
      return NextResponse.json({ athletes: [] });
    }
    const [consentQ, supervisedQ, pendingQ, transferQ] = await Promise.all([
      admin
        .from('consent_records')
        .select('profile_id, action')
        .in('profile_id', ids)
        .order('created_at', { ascending: false }),
      admin
        .from('profile_access')
        .select('user_id, profile_id')
        .in('profile_id', ids)
        .eq('role', 'supervised'),
      admin
        .from('posts')
        .select('profile_id')
        .in('profile_id', ids)
        .eq('status', 'pending_approval'),
      admin
        .from('profile_transfers')
        .select('profile_id, state')
        .in('profile_id', ids)
        .in('state', [...ACTIVE_TRANSFER_STATES]),
    ]);
    const summaries = buildAthleteSummaries(
      ids,
      consentQ.data ?? [],
      supervisedQ.data ?? [],
      pendingQ.data ?? [],
      transferQ.data ?? []
    );
    return NextResponse.json({
      athletes: athletes.map(a => ({ ...a, ...summaries[a.id] })),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] list athletes error:', error);
    return NextResponse.json({ error: 'Could not load athletes' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const limited = await enforceRateLimit(request, 'guardian-athlete-create', { userId: user.id });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const first_name = typeof body.first_name === 'string' ? body.first_name.trim() : '';
    const last_name = typeof body.last_name === 'string' ? body.last_name.trim() : '';
    const dob = typeof body.dob === 'string' ? body.dob : '';
    const handle = typeof body.handle === 'string' ? body.handle.toLowerCase().trim() : '';
    const sport = typeof body.sport === 'string' ? body.sport.trim() : null;

    if (!first_name) {
      return NextResponse.json({ error: "Please enter your athlete's first name." }, { status: 400 });
    }
    if (!dob || !isValidDateString(dob) || !isNotFutureDate(dob)) {
      return NextResponse.json({ error: 'Please enter a valid date of birth.' }, { status: 400 });
    }
    const formatResult = validateHandleFormat(handle);
    if (!formatResult.isValid) {
      return NextResponse.json({ error: formatResult.error || 'Invalid handle format.' }, { status: 400 });
    }
    // Minor-safety: usernames must not leak identity (full name, name +
    // birth-year). The handle IS the child's future login username.
    const pii = validateSupervisedHandle(
      handle, first_name, last_name, new Date(dob).getUTCFullYear()
    );
    if (!pii.ok) {
      return NextResponse.json({ error: pii.reason }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Server-side availability re-check (race guard).
    const { data: availabilityRows } = await admin.rpc('check_handle_availability', {
      input_handle: handle,
      current_profile_id: null,
    });
    if (!availabilityRows?.[0]?.available) {
      return NextResponse.json(
        { error: availabilityRows?.[0]?.reason || 'This handle is not available.' },
        { status: 409 }
      );
    }

    // Shadow auth identity: synthetic email, unknown random password —
    // unloginable by construction until Phase-4 credential issuance.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: `pending-${randomBytes(8).toString('hex')}@minors.invalid`,
      password: randomBytes(32).toString('base64url'),
      email_confirm: true,
    });
    if (createError || !created?.user) {
      Sentry.captureException(new Error(`guardian: shadow user create failed: ${createError?.message}`));
      return NextResponse.json({ error: 'Could not create the profile. Please try again.' }, { status: 500 });
    }
    const childId = created.user.id;
    const syntheticEmail = makeSyntheticEmail(childId);
    // Re-key the synthetic address to the real id for isSyntheticEmail parity.
    await admin.auth.admin.updateUserById(childId, { email: syntheticEmail, email_confirm: true });

    const jurisdiction = jurisdictionFromHeaders(
      request.headers.get('x-vercel-ip-country'),
      request.headers.get('x-vercel-ip-country-region')
    );
    const fullName = [first_name, last_name].filter(Boolean).join(' ');

    const { data: profileId, error: rpcError } = await admin.rpc('create_managed_profile', {
      p_profile: {
        id: childId,
        email: syntheticEmail,
        first_name,
        last_name: last_name || null,
        full_name: fullName || null,
        display_name: fullName || first_name,
        handle,
        dob,
        birthday: dob,
        user_type: 'athlete',
        sport,
        // Minor-safety defaults — restrictive until consent approves more:
        visibility: 'private',
        messaging_permission: 'nobody',
        // Explicit for the same reason as created_at below: the RPC's
        // jsonb_populate_record turns absent fields into explicit NULLs,
        // which bypass column defaults — and this column is NOT NULL (095).
        comment_moderation: 'held',
        supervision_state: 'supervised',
        dob_locked: true,
        jurisdiction,
        minor_threshold_age: getMinorThreshold(jurisdiction),
        // jsonb_populate_record leaves absent fields NULL, and INSERT with
        // explicit NULLs bypasses column defaults — created_at/updated_at
        // are NOT NULL, so they must be supplied here.
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        handle_change_count: 0,
      },
      p_guardian: user.id,
    });

    if (rpcError) {
      // Roll back the shadow user so retries aren't blocked.
      await admin.auth.admin.deleteUser(childId).catch(() => {});
      Sentry.captureException(new Error(`guardian: create_managed_profile failed: ${rpcError.message}`), {
        extra: { guardianId: user.id },
      });
      const friendly = /handle/i.test(rpcError.message)
        ? 'This handle is already taken. Please choose a different one.'
        : 'Could not create the profile. Please try again.';
      return NextResponse.json({ error: friendly }, { status: 409 });
    }

    // Digest routing (Round 4): the child's notifications reach the GUARDIAN's
    // inbox via the daily digest, which drives off notification_preferences.
    // email_enabled is platform-wide opt-IN (default false) — here the
    // guardian is the recipient and creating the profile is the opt-in;
    // executeTransfer flips it back to false so the new adult owner starts
    // at the platform default. Best-effort.
    const { error: prefsError } = await admin
      .from('notification_preferences')
      .upsert(
        { user_id: profileId, email_enabled: true },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );
    if (prefsError) {
      console.error('[GUARDIAN] notification prefs seed failed:', prefsError);
    }

    // Athlete-initiated path: finalize the claimed pending request.
    const pendingProfileId =
      typeof body.pendingProfileId === 'string' ? body.pendingProfileId : null;
    if (pendingProfileId) {
      await admin
        .from('pending_profiles')
        .update({ state: 'approved', promoted_profile_id: profileId })
        .eq('id', pendingProfileId)
        .eq('state', 'consent_pending');
    }

    return NextResponse.json({ ok: true, profileId }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] create athlete error:', error);
    Sentry.captureException(error, { tags: { area: 'guardian-athletes' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
