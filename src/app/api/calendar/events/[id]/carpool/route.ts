import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { enforceRateLimit } from '@/lib/rate-limit';
import { formatDisplayName } from '@/lib/formatters';
import { carpoolAccess } from '@/lib/calendar/carpool';

// ── /api/calendar/events/[id]/carpool ────────────────────────────────────────
// Carpool coordination (Wave 9, mig 139). Offers/claims live in their own
// tables BY DESIGN — events.description/location leak verbatim into ICS +
// invite emails, and ride details must be structurally unable to follow.
//
// Access rule lives in src/lib/calendar/carpool.ts (guest-or-household);
// the driver/rider is always the CALLER's own profile — acting-as is
// deliberately absent (a real adult drives a real car).

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    if (!(await carpoolAccess(admin, id, user.id))) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const { data: offers, error } = await admin
      .from('event_carpool_offers')
      .select('id, driver_profile_id, seats_total, note, created_at, profiles:driver_profile_id (first_name, last_name, full_name), event_carpool_claims (id, rider_profile_id, seats, profiles:rider_profile_id (first_name, last_name, full_name))')
      .eq('event_id', id)
      .order('created_at', { ascending: true });
    if (error) throw error;

    const name = (p: unknown) => {
      const prof = (Array.isArray(p) ? p[0] : p) as
        | { first_name: string | null; last_name: string | null; full_name: string | null }
        | null;
      return prof ? formatDisplayName(prof.first_name, null, prof.last_name, prof.full_name) : '';
    };

    return NextResponse.json({
      offers: (offers ?? []).map(o => {
        const claims = (o.event_carpool_claims ?? []).map(c => ({
          id: c.id,
          riderProfileId: c.rider_profile_id,
          riderName: name(c.profiles),
          seats: c.seats,
        }));
        const taken = claims.reduce((sum, c) => sum + c.seats, 0);
        return {
          id: o.id,
          driverProfileId: o.driver_profile_id,
          driverName: name(o.profiles),
          seatsTotal: o.seats_total,
          seatsLeft: Math.max(0, o.seats_total - taken),
          note: o.note,
          claims,
        };
      }),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CARPOOL] list error:', error);
    return NextResponse.json({ error: 'Could not load carpools' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'carpool-offer', { userId: user.id });
    if (limited) return limited;
    const { id } = await params;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });
    }
    const body = await request.json().catch(() => ({}));
    const seatsTotal = Number(body.seatsTotal);
    if (!Number.isInteger(seatsTotal) || seatsTotal < 1 || seatsTotal > 8) {
      return NextResponse.json({ error: 'seatsTotal must be 1–8' }, { status: 400 });
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : null;

    const admin = getSupabaseAdmin();
    if (!(await carpoolAccess(admin, id, user.id))) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const { data: offer, error } = await admin
      .from('event_carpool_offers')
      .insert({ event_id: id, driver_profile_id: user.id, seats_total: seatsTotal, note: note || null })
      .select('id')
      .maybeSingle();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'You already offered seats for this event.' }, { status: 409 });
      }
      throw error;
    }

    // Tell the going guests a ride exists — a supervised child's carpool
    // news goes to their guardians (carpool is guardian-to-guardian
    // coordination); everyone else hears directly. Driver excluded.
    try {
      const [{ data: event }, { data: guests }] = await Promise.all([
        admin.from('events').select('title').eq('id', id).maybeSingle(),
        admin
          .from('event_guests')
          .select('profile_id, profiles:profile_id (supervision_state)')
          .eq('event_id', id)
          .eq('status', 'accepted'),
      ]);
      const { notifyGuardians, notifyUser, profileFirstName } = await import('@/lib/guardian-notify');
      const driverName = await profileFirstName(admin, user.id);
      const payload = {
        type: 'carpool_offer' as const,
        title: `${driverName} is offering ${seatsTotal} seat${seatsTotal === 1 ? '' : 's'} to ${event?.title ?? 'an event'}`,
        actionUrl: `/app/calendar?event=${id}`,
        actorId: user.id,
        metadata: { event_id: id, offer_id: offer?.id },
      };
      for (const g of guests ?? []) {
        if (g.profile_id === user.id) continue;
        const prof = (Array.isArray(g.profiles) ? g.profiles[0] : g.profiles) as
          | { supervision_state: string | null }
          | null;
        if (prof?.supervision_state === 'supervised') {
          await notifyGuardians(admin, g.profile_id as string, payload, user.id);
        } else {
          await notifyUser(admin, g.profile_id as string, payload);
        }
      }
    } catch (notifyError) {
      console.error('[CARPOOL] offer fan-out failed:', notifyError);
    }

    return NextResponse.json({ ok: true, id: offer?.id }, { status: 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CARPOOL] offer error:', error);
    return NextResponse.json({ error: 'Could not offer seats' }, { status: 500 });
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
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    // Own-offer delete only; tell the riders their ride is off.
    const { data: offer } = await admin
      .from('event_carpool_offers')
      .select('id, event_carpool_claims (rider_profile_id)')
      .eq('event_id', id)
      .eq('driver_profile_id', user.id)
      .maybeSingle();
    if (!offer) {
      return NextResponse.json({ error: 'No offer to remove' }, { status: 404 });
    }
    const riders = (offer.event_carpool_claims ?? []).map(c => c.rider_profile_id as string);
    const { error } = await admin.from('event_carpool_offers').delete().eq('id', offer.id);
    if (error) throw error;
    try {
      const { notifyUser, profileFirstName } = await import('@/lib/guardian-notify');
      const driverName = await profileFirstName(admin, user.id);
      for (const rider of riders) {
        await notifyUser(admin, rider, {
          type: 'carpool_update',
          title: `${driverName} can no longer drive — find another ride`,
          actionUrl: `/app/calendar?event=${id}`,
          actorId: user.id,
          metadata: { event_id: id },
        });
      }
    } catch (notifyError) {
      console.error('[CARPOOL] cancel fan-out failed:', notifyError);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CARPOOL] delete error:', error);
    return NextResponse.json({ error: 'Could not remove the offer' }, { status: 500 });
  }
}
