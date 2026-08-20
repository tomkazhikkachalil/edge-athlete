import type { SupabaseClient } from '@supabase/supabase-js';
import { emailService } from './email-service';
import { isSyntheticEmail } from './config/minors-config';

// Notification-digest job, extracted from the cron route so the combined
// /api/cron/daily can run it alongside the transfer sweep (Vercel Hobby's
// 2-cron cap). Logic unchanged except: synthetic minor addresses
// (@minors.invalid) are skipped — they can never receive mail.
export async function runNotificationDigest(supabase: SupabaseClient, appUrl: string) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return { ok: true, skipped: 'SMTP not configured', sent: 0, considered: 0 };
  }

  const { data: prefs, error: prefsError } = await supabase
    .from('notification_preferences')
    .select('user_id, last_digest_at')
    .eq('email_enabled', true)
    .limit(200);
  if (prefsError) {
    console.error('[DIGEST] preferences query failed:', prefsError);
    return { ok: false, error: 'Failed to load preferences', sent: 0, considered: 0 };
  }
  if (!prefs || prefs.length === 0) return { ok: true, sent: 0, considered: 0 };

  let sent = 0;
  const nowIso = new Date().toISOString();
  for (const pref of prefs) {
    try {
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

      // Watermark discipline: advance immediately when there's nothing to
      // send, otherwise only AFTER a successful send. Advancing before the
      // send permanently burned the window when the send failed — those
      // notifications were never digested again (live data loss while the
      // sender domain was unverified and every send 550'd).
      const advanceWatermark = () => supabase
        .from('notification_preferences')
        .update({ last_digest_at: nowIso })
        .eq('user_id', pref.user_id);

      if (!notifs || notifs.length === 0) {
        await advanceWatermark();
        continue;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('email, first_name, last_name, full_name, supervision_state')
        .eq('id', pref.user_id)
        .maybeSingle();
      if (!profile?.email) {
        // Structurally undeliverable — don't retry forever.
        await advanceWatermark();
        continue;
      }

      if (isSyntheticEmail(profile.email)) {
        // A supervised child's synthetic address can never receive mail —
        // route their digest to the guardian(s) instead (Round 4). The
        // routing ends structurally at transfer: guardian rows are removed
        // and the child gains a real email.
        if (profile.supervision_state !== 'supervised') {
          await advanceWatermark();
          continue;
        }
        const { data: guardianRows } = await supabase
          .from('profile_access')
          .select('profiles!profile_access_user_id_fkey(email)')
          .eq('profile_id', pref.user_id)
          .eq('role', 'guardian');
        const guardianEmails = (guardianRows ?? [])
          .map(r => (r.profiles as unknown as { email: string | null })?.email)
          .filter((e): e is string => !!e && !isSyntheticEmail(e));
        for (const guardianEmail of guardianEmails) {
          await emailService.sendChildDigest(
            guardianEmail, profile.first_name || 'Your athlete', notifs, appUrl
          );
          sent++;
        }
        // All guardian sends succeeded (a throw lands in the per-user
        // catch below and the watermark stays put — a retry may re-send to
        // an earlier guardian, which is a harmless duplicate).
        await advanceWatermark();
        continue;
      }

      const displayName =
        [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
        profile.full_name || '';
      await emailService.sendNotificationDigest(profile.email, displayName, notifs, appUrl);
      sent++;
      await advanceWatermark();
    } catch (userError) {
      // One user's failure never stops the batch
      console.error('[DIGEST] failed for user', pref.user_id, userError);
    }
  }
  return { ok: true, sent, considered: prefs.length };
}
