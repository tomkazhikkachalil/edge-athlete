import type { SupabaseClient } from '@supabase/supabase-js';
import { dispatch, emailDelivered } from './notify/dispatch';
import { isSyntheticEmail } from './config/minors-config';
import { isStubEmail } from './config/stubs-config';
import { buildDigestGroups } from './digest-groups';
import { chunk } from './chunk';

// How many users a single cron run processes concurrently. The per-user work
// (a few queries + a mail send) used to run fully serially — ~600-800 serial
// round-trips at 200 opted-in users, which risked the 60s /api/cron/daily
// budget (digest is one of its 5 phases). Batches run in sequence; users
// within a batch run in parallel, bounding fan-out so the DB pool and SMTP
// throughput are never swamped.
const DIGEST_BATCH_SIZE = 10;

type DigestPref = { user_id: string; last_digest_at: string | null };

// Notification-digest job, extracted from the cron route so the combined
// /api/cron/daily can run it alongside the transfer sweep (Vercel Hobby's
// 2-cron cap). Synthetic minor addresses (@minors.invalid) are routed to the
// guardian(s) rather than mailed directly.
export async function runNotificationDigest(supabase: SupabaseClient, appUrl: string) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    // Loud on purpose: a green cron run that silently sent nothing is
    // indistinguishable from a healthy one in logs otherwise (the digest was
    // dark for weeks before anyone noticed the launch-runbook gate).
    console.warn('[digest] SKIPPED — SMTP not configured; no digest emails were sent.');
    return { ok: true, skipped: 'SMTP not configured', sent: 0, considered: 0 };
  }

  // Ordered least-recently-digested first (nulls = never digested, first):
  // the un-ordered LIMIT used to starve everyone past row 200 FOREVER — the
  // same 200 arbitrary users each night (Wave 5 fix).
  const { data: prefs, error: prefsError } = await supabase
    .from('notification_preferences')
    .select('user_id, last_digest_at')
    .eq('email_enabled', true)
    .order('last_digest_at', { ascending: true, nullsFirst: true })
    .limit(200);
  if (prefsError) {
    console.error('[DIGEST] preferences query failed:', prefsError);
    return { ok: false, error: 'Failed to load preferences', sent: 0, considered: 0 };
  }
  if (!prefs || prefs.length === 0) return { ok: true, sent: 0, considered: 0 };

  const nowIso = new Date().toISOString();

  // One user's work. Returns how many emails it sent (0+). Never throws — a
  // failure is logged and counts as 0, so it can't sink the rest of its batch.
  const processOne = async (pref: DigestPref): Promise<number> => {
    try {
      // metadata carries notifyGuardians' profile_id stamp — the digest's
      // per-athlete grouping key (Wave 5; the old select was title-only,
      // which is why every digest read as an undifferentiated title list).
      let notifQuery = supabase
        .from('notifications')
        .select('title, message, type, action_url, metadata, created_at')
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
        return 0;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('email, first_name, last_name, full_name, supervision_state')
        .eq('id', pref.user_id)
        .maybeSingle();
      if (!profile?.email) {
        // Structurally undeliverable — don't retry forever.
        await advanceWatermark();
        return 0;
      }

      if (isStubEmail(profile.email)) {
        // An UNCLAIMED roster stub (phase 1 R3): the domain is unroutable
        // and no guardians exist to route to — advance and drop. After a
        // guardian claim the email is @minors.invalid (the branch below);
        // after an adult claim it's real.
        await advanceWatermark();
        return 0;
      }

      if (isSyntheticEmail(profile.email)) {
        // A supervised child's synthetic address can never receive mail —
        // route their digest to the guardian(s) instead (Round 4). The
        // routing ends structurally at transfer: guardian rows are removed
        // and the child gains a real email.
        if (profile.supervision_state !== 'supervised') {
          await advanceWatermark();
          return 0;
        }
        const { data: guardianRows } = await supabase
          .from('profile_access')
          .select('profiles!profile_access_user_id_fkey(email)')
          .eq('profile_id', pref.user_id)
          .eq('role', 'guardian');
        const guardianEmails = (guardianRows ?? [])
          .map(r => (r.profiles as unknown as { email: string | null })?.email)
          .filter((e): e is string => !!e && !isSyntheticEmail(e));
        // Zero deliverable guardians used to fall through `[].every → true`
        // and advance the watermark SILENTLY — same outcome, but now loud
        // (Wave 5): this is a supervised child whose activity reaches no
        // adult inbox, which an operator needs to see.
        if (guardianEmails.length === 0) {
          console.warn(
            '[DIGEST] supervised child has NO deliverable guardian email — digest dropped:',
            pref.user_id
          );
          await advanceWatermark();
          return 0;
        }
        // One child's guardians are independent recipients — fan the sends
        // out through the dispatcher (Wave 7). The gating pref here is the
        // CHILD's email_enabled (already true by the query), not each
        // guardian's own digest pref — Round 4 design, preserved.
        const results = await Promise.all(
          guardianEmails.map(guardianEmail => dispatch({
            tier: 'digest',
            payload: {
              kind: 'child_digest',
              childFirstName: profile.first_name || 'Your athlete',
              items: notifs,
            },
            recipient: { email: guardianEmail, displayName: '' },
            prefs: { emailEnabled: true },
            appUrl,
          }))
        );
        // Watermark advances only when EVERY guardian send succeeded (Round E,
        // mirroring the main digest's rule). On partial failure it holds
        // without throwing, so this digest retries next run — accepted
        // tradeoff: a persistently bouncing co-guardian re-sends to the
        // healthy one until fixed, which beats silently dropping the digest.
        if (results.every(emailDelivered)) await advanceWatermark();
        return results.filter(emailDelivered).length;
      }

      const displayName =
        [profile.first_name, profile.last_name].filter(Boolean).join(' ') ||
        profile.full_name || '';

      // Per-athlete grouping (Wave 5): guardian fan-out rows carry
      // metadata.profile_id — lead with each child's section, the
      // recipient's own activity under "For you". A user with only
      // ungrouped rows renders the flat classic template.
      const groups = buildDigestGroups(notifs);
      const childIds = groups.map(g => g.profileId).filter((id): id is string => !!id);
      const namesById = new Map<string, string>();
      if (childIds.length > 0) {
        const { data: childRows } = await supabase
          .from('profiles')
          .select('id, first_name, display_name, full_name')
          .in('id', childIds);
        for (const c of childRows ?? []) {
          namesById.set(c.id, c.first_name || c.display_name || c.full_name || 'Your athlete');
        }
      }
      const namedGroups = groups.map(g => ({
        childName: g.profileId ? namesById.get(g.profileId) ?? 'Your athlete' : null,
        items: g.items,
      }));

      // Boolean-gated watermark (Wave 5): the old adult path was a raw
      // sendMail that only held the watermark by accidental throw-unwind.
      // Wave 7: through the dispatcher; email_enabled true by the query.
      const results = await dispatch({
        tier: 'digest',
        payload: { kind: 'guardian_digest', groups: namedGroups },
        recipient: { email: profile.email, displayName },
        prefs: { emailEnabled: true },
        appUrl,
      });
      const ok = emailDelivered(results);
      if (ok) await advanceWatermark();
      return ok ? 1 : 0;
    } catch (userError) {
      // One user's failure never stops the batch
      console.error('[DIGEST] failed for user', pref.user_id, userError);
      return 0;
    }
  };

  let sent = 0;
  for (const batch of chunk(prefs as DigestPref[], DIGEST_BATCH_SIZE)) {
    const counts = await Promise.all(batch.map(processOne));
    sent += counts.reduce((a, b) => a + b, 0);
  }
  return { ok: true, sent, considered: prefs.length };
}
