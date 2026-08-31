import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { dispatch, emailDelivered } from '@/lib/notify/dispatch';
import { isSyntheticEmail } from '@/lib/config/minors-config';
import { isStubEmail } from '@/lib/config/stubs-config';
import {
  buildUrgentBatches,
  safeInternalPath,
  type UrgentRecipientInfo,
  type UrgentRow,
} from '@/lib/urgent-email';

export const maxDuration = 60;

const URGENT_TYPES = ['safety_alert', 'consent_result'];
const LOOKBACK_MS = 24 * 3_600_000;

// ── GET /api/cron/urgent-emails ──────────────────────────────────────────────
// Invoked every 10 minutes by Supabase pg_cron (migration 135). The two
// guardian-critical notification types get an email within ~10 minutes of
// landing; everything else rides the nightly digest.
//
// Deliberately NOT gated on any feature flag — the reminders route's flag
// 200-skip once hid a live pipeline behind a dark surface switch, and a
// safety email must never hide behind one (flags are surface switches, never
// safety switches).
//
// Dedup: rows are stamped emailed_at BEFORE the send (the reminded_at
// stance — with a 10-minute loop, double-send is the dominant risk; the
// nightly digest is the backstop since it keys on last_digest_at and
// ignores emailed_at entirely). Structural skips — disabled preference,
// synthetic or missing email — are never stamped: they age out of the 24h
// lookback and still ride the digest, and toggling urgent ON later never
// replays old alerts.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    // Loud on purpose (the digest's rule): a green run that silently sent
    // nothing is indistinguishable from a healthy one otherwise. Rows stay
    // unstamped, so mail flows the moment SMTP is configured.
    console.warn('[URGENT] SKIPPED — SMTP not configured; no urgent emails were sent.');
    return NextResponse.json({ ok: true, skipped: 'SMTP not configured', sent: 0, considered: 0 });
  }

  const supabase = getSupabaseAdmin();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
  try {
    const { data: rows, error } = await supabase
      .from('notifications')
      .select('id, user_id, type, title, message, action_url, created_at')
      .in('type', URGENT_TYPES)
      .is('emailed_at', null)
      .gt('created_at', new Date(Date.now() - LOOKBACK_MS).toISOString())
      .order('created_at', { ascending: true })
      .limit(200);
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, considered: 0, skipped: 0 });
    }

    const userIds = [...new Set(rows.map(r => r.user_id as string))];
    const [{ data: prefRows }, { data: profileRows }] = await Promise.all([
      supabase
        .from('notification_preferences')
        .select('user_id, urgent_email_enabled')
        .in('user_id', userIds),
      supabase
        .from('profiles')
        .select('id, email, first_name, last_name, full_name')
        .in('id', userIds),
    ]);
    const prefById = new Map((prefRows ?? []).map(p => [p.user_id as string, p]));
    const recipients = new Map<string, UrgentRecipientInfo>();
    for (const p of profileRows ?? []) {
      const pref = prefById.get(p.id);
      recipients.set(p.id, {
        email: p.email ?? null,
        displayName:
          [p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || '',
        // Missing prefs row = never opted out (the column defaults true).
        urgentEnabled: pref ? pref.urgent_email_enabled !== false : true,
        synthetic: !!p.email && (isSyntheticEmail(p.email) || isStubEmail(p.email)),
      });
    }

    const { batches, skipped } = buildUrgentBatches(rows as UrgentRow[], recipients);

    let sent = 0;
    for (const batch of batches) {
      // Stamp FIRST — see the header. A send failure leaves the rows
      // stamped; the nightly digest still summarizes them.
      const { error: stampError } = await supabase
        .from('notifications')
        .update({ emailed_at: new Date().toISOString() })
        .in('id', batch.items.map(i => i.id));
      if (stampError) {
        console.error('[URGENT] stamp failed — batch skipped:', stampError);
        continue;
      }
      const results = await dispatch({
        tier: 'urgent',
        payload: {
          kind: 'urgent_alert',
          items: batch.items.map(i => ({
            title: i.title,
            message: i.message ?? null,
            path: safeInternalPath(i.action_url),
          })),
        },
        recipient: { email: batch.email, displayName: batch.displayName },
        // Batches are pre-filtered by buildUrgentBatches (urgentEnabled), so
        // this is true by construction; real per-channel prefs plumb through
        // the batch shape when SMS is provisioned.
        prefs: { urgentEmailEnabled: true },
        appUrl,
      });
      if (emailDelivered(results)) sent += 1;
    }

    if (batches.length > 0) {
      console.log('[URGENT]', JSON.stringify({ considered: rows.length, sent, skipped }));
    }
    return NextResponse.json({ ok: true, sent, considered: rows.length, skipped });
  } catch (error) {
    console.error('[URGENT] sweep failed:', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
