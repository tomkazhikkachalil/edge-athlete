import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { runNotificationDigest } from '@/lib/digest-server';

// ── GET /api/cron/notification-digest ─────────────────────────────────────────
// Emails opted-in users (notification_preferences.email_enabled) a digest of
// notifications created since their last digest, watermarked by last_digest_at.
//
// This route is NOT on a Vercel cron (only /api/cron/daily is, which runs the
// same job as one of its phases). It stays as a manually-triggerable entry
// point and now delegates to the single shared implementation in
// digest-server.ts — the previous inline copy had drifted: it advanced the
// watermark BEFORE sending (data-loss on a failed send) and never routed a
// supervised minor's digest to their guardians. One implementation, one set of
// rules.
//
// Auth: Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` when
// CRON_SECRET is set. We require it — this route must not be publicly callable
// (it sends email). No SMTP configured → no-op success (nothing to send).
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (request.headers.get('origin') ?? `https://${request.headers.get('host')}`);

  try {
    const result = await runNotificationDigest(getSupabaseAdmin(), appUrl);
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Digest failed' }, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error('[DIGEST] cron error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
