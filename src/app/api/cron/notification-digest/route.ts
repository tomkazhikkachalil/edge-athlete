import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { emailService } from '@/lib/email-service';

// ── GET /api/cron/notification-digest ─────────────────────────────────────────
// Emails opted-in users (notification_preferences.email_enabled) a digest of
// notifications created since their last digest. Watermarked by last_digest_at
// so nothing is emailed twice.
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

  // No mailer configured → nothing to do (don't error the cron)
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return NextResponse.json({ ok: true, skipped: 'SMTP not configured', sent: 0 });
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (request.headers.get('origin') ?? `https://${request.headers.get('host')}`);

  try {
    const supabase = getSupabaseAdmin();

    // Opted-in users. Cap the batch so a single cron run can't time out;
    // remaining users are picked up next run (their last_digest_at is older).
    const { data: prefs, error: prefsError } = await supabase
      .from('notification_preferences')
      .select('user_id, last_digest_at')
      .eq('email_enabled', true)
      .limit(200);

    if (prefsError) {
      console.error('[DIGEST] preferences query failed:', prefsError);
      return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
    }
    if (!prefs || prefs.length === 0) {
      return NextResponse.json({ ok: true, sent: 0 });
    }

    let sent = 0;
    const nowIso = new Date().toISOString();

    for (const pref of prefs) {
      try {
        // New notifications since the last digest (or all unread if never sent)
        let notifQuery = supabase
          .from('notifications')
          .select('title, created_at')
          .eq('user_id', pref.user_id)
          .eq('is_read', false)
          .order('created_at', { ascending: false })
          .limit(50);
        if (pref.last_digest_at) {
          notifQuery = notifQuery.gt('created_at', pref.last_digest_at);
        }
        const { data: notifs } = await notifQuery;

        // Always advance the watermark (even with 0 new) so we don't re-scan
        // the same window forever.
        await supabase
          .from('notification_preferences')
          .update({ last_digest_at: nowIso })
          .eq('user_id', pref.user_id);

        if (!notifs || notifs.length === 0) continue;

        // Recipient email + name
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, first_name, last_name, full_name')
          .eq('id', pref.user_id)
          .maybeSingle();
        if (!profile?.email) continue;

        const displayName =
          [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
          profile.full_name ||
          '';

        await emailService.sendNotificationDigest(profile.email, displayName, notifs, appUrl);
        sent++;
      } catch (userError) {
        // One user's failure never stops the batch
        console.error('[DIGEST] failed for user', pref.user_id, userError);
      }
    }

    return NextResponse.json({ ok: true, sent, considered: prefs.length });
  } catch (error) {
    console.error('[DIGEST] cron error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
