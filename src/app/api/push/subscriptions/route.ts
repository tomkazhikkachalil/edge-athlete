import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { isMissingTableError } from '@/lib/orgs/validate';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/push/subscriptions (mig 248) ───────────────────────────────────────
// A device turning phone notifications on (POST) or off (DELETE) for the
// signed-in person. The endpoint is a device's address at its push service
// and is unique across everyone: signing in as someone else on the same
// phone MOVES the row (upsert on endpoint), so a shared phone never buzzes
// for the previous person. Not behind the write gate — this is delivery to
// yourself, not content. Every response is private, no-store.

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const SubscribeSchema = z.object({
  endpoint: z.string().url().max(2000).refine(v => v.startsWith('https://'), 'endpoint must be https'),
  keys: z.object({
    p256dh: z.string().min(16).max(200),
    auth: z.string().min(8).max(100),
  }),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await getServerAuth(request);
    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
    }
    const limited = await enforceRateLimit(request, 'push-subscribe', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, SubscribeSchema);
    if (!parsed.success) return parsed.response;

    const admin = getSupabaseAdmin();
    const { error: upsertError } = await admin.from('push_subscriptions').upsert(
      {
        profile_id: user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        user_agent: request.headers.get('user-agent')?.slice(0, 400) ?? null,
        failure_count: 0,
      },
      { onConflict: 'endpoint' }
    );
    if (upsertError) {
      if (isMissingTableError(upsertError.code)) {
        return NextResponse.json({ error: 'Phone notifications are not available yet' }, { status: 503, headers: NO_STORE });
      }
      reportRouteError('[PUSH] subscribe failed:', upsertError);
      return NextResponse.json({ error: 'Could not turn on notifications. Please try again.' }, { status: 500, headers: NO_STORE });
    }
    // Turning a device on is also the account's "yes" — the sweep skips an
    // account whose push_enabled is false.
    await admin.from('notification_preferences').update({ push_enabled: true }).eq('user_id', user.id);
    return NextResponse.json({ ok: true }, { status: 201, headers: NO_STORE });
  } catch (error) {
    reportRouteError('[PUSH] subscribe error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, error } = await getServerAuth(request);
    if (error || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401, headers: NO_STORE });
    }
    const limited = await enforceRateLimit(request, 'push-subscribe', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, UnsubscribeSchema);
    if (!parsed.success) return parsed.response;

    const { error: deleteError } = await getSupabaseAdmin()
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', parsed.data.endpoint)
      .eq('profile_id', user.id);
    if (deleteError && !isMissingTableError(deleteError.code)) {
      reportRouteError('[PUSH] unsubscribe failed:', deleteError);
      return NextResponse.json({ error: 'Could not turn off notifications. Please try again.' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    reportRouteError('[PUSH] unsubscribe error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
