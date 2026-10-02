import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { vapidConfig } from '@/lib/push/config-server';
import { sendToSubscription, type PushSubscriptionRow } from '@/lib/push/send-server';
import { isMissingTableError } from '@/lib/orgs/validate';
import { reportRouteError } from '@/lib/observability/report';

// ── POST /api/push/test (mig 248) ───────────────────────────────────────────
// "Send a test notification" in Settings: one push to every device the
// signed-in person has turned on — the quickest way to tell "it is set up"
// from "it is not", on the phone in your hand. It carries the real unread
// count, so the icon's number shows too. Shares the subscribe bucket.

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getServerAuth(request);
    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
    }
    const limited = await enforceRateLimit(request, 'push-subscribe', { userId: user.id });
    if (limited) return limited;
    const vapid = vapidConfig();
    if (!vapid) {
      return NextResponse.json({ error: 'Phone notifications are not available' }, { status: 503, headers: NO_STORE });
    }
    const admin = getSupabaseAdmin();
    const [{ data: subs, error: subsError }, { count }] = await Promise.all([
      admin
        .from('push_subscriptions')
        .select('id, profile_id, endpoint, p256dh, auth, failure_count')
        .eq('profile_id', user.id),
      admin.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_read', false),
    ]);
    if (subsError) {
      if (isMissingTableError(subsError.code)) {
        return NextResponse.json({ error: 'Phone notifications are not available yet' }, { status: 503, headers: NO_STORE });
      }
      throw subsError;
    }
    const devices = (subs ?? []) as PushSubscriptionRow[];
    if (devices.length === 0) {
      return NextResponse.json({ error: 'No device has notifications turned on' }, { status: 409, headers: NO_STORE });
    }
    let sent = 0;
    for (const device of devices) {
      const outcome = await sendToSubscription(admin, vapid, device, {
        id: '',
        title: 'Edge Athlete',
        body: 'Phone notifications are on. This is what new activity will look like.',
        url: '/app/notifications',
        badge: count ?? 0,
        tag: 'test',
      });
      if (outcome === 'sent') sent += 1;
    }
    return NextResponse.json({ ok: sent > 0, devices: devices.length, sent }, { status: sent > 0 ? 200 : 502, headers: NO_STORE });
  } catch (error) {
    reportRouteError('[PUSH] test failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
