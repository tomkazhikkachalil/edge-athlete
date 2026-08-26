import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { ACTIVE_TRANSFER_STATES } from '@/lib/transfers';
import { notifyGuardians, profileFirstName } from '@/lib/guardian-notify';

// ── /api/transfers ────────────────────────────────────────────────────────────
// GET ?profileId= → the active transfer (guardian/supervised/owner view).
// POST {profileId} → guardian INITIATES, or the supervised athlete REQUESTS
// (which notifies the guardian rather than executing — spec).

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ transfer: null });
    }
    const profileId = request.nextUrl.searchParams.get('profileId') ?? '';
    if (profileId && !isUuid(profileId)) {
      return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    }
    const role = await getProfileRole(user.id, profileId);
    if (!role) return NextResponse.json({ error: 'Not permitted' }, { status: 403 });

    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('profile_transfers')
      .select('id, state, initiated_by, athlete_contact_email, contact_verified_at, athlete_confirmed_at, guardian_confirmed_at, cooling_off_ends_at, guardian_post_role, created_at')
      .eq('profile_id', profileId)
      .in('state', [...ACTIVE_TRANSFER_STATES])
      .maybeSingle();

    // Nothing active: report the latest terminal row too (Round D), so a
    // dead attempt (aborted/failed/expired) renders honestly instead of the
    // page looping back to a bare "Start the handover".
    let lastTransfer = null;
    if (!data) {
      const { data: terminal } = await admin
        .from('profile_transfers')
        .select('state, updated_at')
        .eq('profile_id', profileId)
        .in('state', ['completed', 'aborted', 'failed', 'expired'])
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      lastTransfer = terminal ?? null;
    }
    return NextResponse.json({ transfer: data ?? null, lastTransfer, viewerRole: role });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Could not load transfer' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const profileId = typeof body.profileId === 'string' ? body.profileId : '';
    const role = await getProfileRole(user.id, profileId);
    if (role !== 'guardian' && role !== 'supervised') {
      return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
    }
    const admin = getSupabaseAdmin();
    const { data: profile } = await admin
      .from('profiles')
      .select('dob, supervision_state')
      .eq('id', profileId)
      .maybeSingle();
    if (!profile || profile.supervision_state !== 'supervised' || !profile.dob) {
      return NextResponse.json({ error: 'This profile has no supervision to transfer.' }, { status: 400 });
    }

    const { data: existing } = await admin
      .from('profile_transfers')
      .select('id, state')
      .eq('profile_id', profileId)
      .in('state', [...ACTIVE_TRANSFER_STATES])
      .maybeSingle();

    const targetState = role === 'guardian' ? 'initiated' : 'requested';
    if (existing) {
      // Upgrade the system flag / athlete request; never downgrade.
      const upgradable =
        (existing.state === 'eligible_notified') ||
        (existing.state === 'requested' && role === 'guardian');
      if (!upgradable) {
        return NextResponse.json({ transfer: existing, already: true });
      }
      const { data: updated } = await admin
        .from('profile_transfers')
        // initiated_by CHECK allows 'athlete', not the 'supervised' role string.
        .update({
          state: targetState,
          initiated_by: role === 'supervised' ? 'athlete' : role,
          initiator_user_id: user.id,
        })
        .eq('id', existing.id)
        .select('id, state')
        .single();
      if (targetState === 'requested') {
        await notifyGuardians(admin, profileId, {
          type: 'transfer_update',
          title: `${await profileFirstName(admin, profileId)} asked to take over their account`,
          actionUrl: `/app/transfer/${profileId}`,
          actorId: profileId,
        });
      }
      return NextResponse.json({ transfer: updated });
    }

    const { data: created, error } = await admin
      .from('profile_transfers')
      .insert({
        profile_id: profileId,
        state: targetState,
        initiated_by: role === 'supervised' ? 'athlete' : role,
        initiator_user_id: user.id,
        dob_snapshot: profile.dob,
      })
      .select('id, state')
      .single();
    if (error) throw error;
    if (targetState === 'requested') {
      await notifyGuardians(admin, profileId, {
        type: 'transfer_update',
        title: `${await profileFirstName(admin, profileId)} asked to take over their account`,
        actionUrl: `/app/transfer/${profileId}`,
        actorId: profileId,
      });
    }
    return NextResponse.json({ transfer: created }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[TRANSFERS] create error:', error);
    Sentry.captureException(error, { tags: { area: 'transfers' } });
    return NextResponse.json({ error: 'Could not start the transfer' }, { status: 500 });
  }
}
