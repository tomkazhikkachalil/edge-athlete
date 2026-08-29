import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { enforceRateLimit } from '@/lib/rate-limit';
import { carpoolAccess } from '@/lib/calendar/carpool';

// ── /api/calendar/events/[id]/carpool/claim ──────────────────────────────────
// Claim / release seats on an offer (Wave 9, mig 139). Rider = the CALLER,
// first-person by design (see the carpool route header). Capacity is
// enforced here (v1 — single write path); the UNIQUE(offer, rider) makes a
// double-claim a 409, not a duplicate.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'carpool-claim', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const offerId = typeof body.offerId === 'string' ? body.offerId : '';
    if (!isUuid(id) || !isUuid(offerId)) {
      return NextResponse.json({ error: 'Invalid ids' }, { status: 400 });
    }
    const rawSeats = body.seats === undefined ? 1 : Number(body.seats);
    if (!Number.isInteger(rawSeats) || rawSeats < 1 || rawSeats > 4) {
      return NextResponse.json({ error: 'seats must be 1–4' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    if (!(await carpoolAccess(admin, id, user.id))) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }
    const { data: offer } = await admin
      .from('event_carpool_offers')
      .select('id, driver_profile_id, seats_total, event_carpool_claims (seats)')
      .eq('id', offerId)
      .eq('event_id', id)
      .maybeSingle();
    if (!offer) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 });
    }
    if (offer.driver_profile_id === user.id) {
      return NextResponse.json({ error: "You're the driver." }, { status: 409 });
    }
    const taken = (offer.event_carpool_claims ?? []).reduce((s, c) => s + c.seats, 0);
    if (taken + rawSeats > offer.seats_total) {
      return NextResponse.json({ error: 'Not enough seats left.' }, { status: 409 });
    }

    const { error } = await admin
      .from('event_carpool_claims')
      .insert({ offer_id: offerId, rider_profile_id: user.id, seats: rawSeats });
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'You already claimed seats on this ride.' }, { status: 409 });
      }
      throw error;
    }

    try {
      const { notifyUser, profileFirstName } = await import('@/lib/guardian-notify');
      const riderName = await profileFirstName(admin, user.id);
      await notifyUser(admin, offer.driver_profile_id as string, {
        type: 'carpool_update',
        title: `${riderName} claimed ${rawSeats} seat${rawSeats === 1 ? '' : 's'} in your carpool`,
        actionUrl: `/calendar?event=${id}`,
        actorId: user.id,
        metadata: { event_id: id, offer_id: offerId },
      });
    } catch (notifyError) {
      console.error('[CARPOOL] claim notify failed:', notifyError);
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CARPOOL] claim error:', error);
    return NextResponse.json({ error: 'Could not claim seats' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const offerId = typeof body.offerId === 'string' ? body.offerId : '';
    if (!isUuid(id) || !isUuid(offerId)) {
      return NextResponse.json({ error: 'Invalid ids' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const { data: removed, error } = await admin
      .from('event_carpool_claims')
      .delete()
      .eq('offer_id', offerId)
      .eq('rider_profile_id', user.id)
      .select('id');
    if (error) throw error;
    if (!removed?.length) {
      return NextResponse.json({ error: 'No claim to release' }, { status: 404 });
    }
    try {
      const { data: offer } = await admin
        .from('event_carpool_offers')
        .select('driver_profile_id')
        .eq('id', offerId)
        .maybeSingle();
      if (offer) {
        const { notifyUser, profileFirstName } = await import('@/lib/guardian-notify');
        const riderName = await profileFirstName(admin, user.id);
        await notifyUser(admin, offer.driver_profile_id as string, {
          type: 'carpool_update',
          title: `${riderName} released their carpool seats`,
          actionUrl: `/calendar?event=${id}`,
          actorId: user.id,
          metadata: { event_id: id, offer_id: offerId },
        });
      }
    } catch (notifyError) {
      console.error('[CARPOOL] release notify failed:', notifyError);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CARPOOL] release error:', error);
    return NextResponse.json({ error: 'Could not release the claim' }, { status: 500 });
  }
}
