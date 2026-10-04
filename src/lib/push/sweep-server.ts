import type { SupabaseClient } from '@supabase/supabase-js';
import { vapidConfig } from './config-server';
import {
  MAX_PUSHES_PER_RECIPIENT,
  pushPayloadFor,
  rowsToSend,
  type PushNotificationRow,
} from './payload';
import { sendToSubscription, type PushSubscriptionRow } from './send-server';

// ── The push sweep (mig 248) — SERVER ONLY ──────────────────────────────────
// The ONE place a phone notification is sent from. About sixty writers and
// seven triggers insert notifications; none of them knows about phones. Every
// minute pg_cron calls POST /api/push/sweep, which runs this:
//
//   1. CLAIM: stamp pushed_at on every unconsidered row from the last
//      FRESH_MINUTES, returning them. The stamp comes BEFORE the send (135's
//      urgent-email rule: a crash loses a buzz; it never sends one twice) and
//      the UPDATE is the lock — a second sweep running at the same moment
//      finds the rows already stamped.
//   2. Older unconsidered rows (the sweep was down) are stamped WITHOUT a
//      send: a buzz about something from an hour ago is noise, and the bell
//      and the icon number still show it.
//   3. Per recipient with a device and push not switched off: the newest row
//      per tag (likes on a post collapse, a conversation collapses), at most
//      MAX_PUSHES_PER_RECIPIENT, each carrying the bell's unread count for
//      the icon number.
//
// Never throws for one row or one device; the caller reports a whole-sweep
// failure.

export const FRESH_MINUTES = 15;
const RECIPIENT_BATCH = 100;

export interface SweepResult {
  ok: boolean;
  skipped?: 'needs_248';
  claimed: number;
  stale: number;
  recipients: number;
  sent: number;
  gone: number;
  failed: number;
  /** Rows claimed while the deployment has no keys — stamped, not sent. */
  unsent_no_keys?: number;
}

const isMissingSchema = (code: string | undefined) =>
  code === '42703' || code === 'PGRST204' || code === '42P01' || code === 'PGRST205';

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function runPushSweep(admin: SupabaseClient, now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { ok: true, claimed: 0, stale: 0, recipients: 0, sent: 0, gone: 0, failed: 0 };
  const stamp = now.toISOString();
  const since = new Date(now.getTime() - FRESH_MINUTES * 60_000).toISOString();

  // 1. Claim the fresh rows.
  const { data: claimed, error: claimError } = await admin
    .from('notifications')
    .update({ pushed_at: stamp })
    .is('pushed_at', null)
    // Read before the sweep got to it (the bell opened, the chat read): no
    // buzz about it. It ages into the stale stamp below.
    .eq('is_read', false)
    .gte('created_at', since)
    .select('id, user_id, type, title, message, action_url, post_id, metadata, created_at');
  if (claimError) {
    if (isMissingSchema(claimError.code)) return { ...result, skipped: 'needs_248' };
    throw claimError;
  }

  // 2. Stamp what is too old to buzz about.
  const { count: staleCount } = await admin
    .from('notifications')
    .update({ pushed_at: stamp }, { count: 'exact' })
    .is('pushed_at', null)
    .lt('created_at', since);
  result.stale = staleCount ?? 0;

  const rows = (claimed ?? []) as Array<PushNotificationRow & { user_id: string }>;
  result.claimed = rows.length;
  if (rows.length === 0) return result;

  const vapid = vapidConfig();
  if (!vapid) {
    result.unsent_no_keys = rows.length;
    return result;
  }

  const byRecipient = new Map<string, Array<PushNotificationRow & { user_id: string }>>();
  for (const row of rows) {
    const list = byRecipient.get(row.user_id);
    if (list) list.push(row);
    else byRecipient.set(row.user_id, [row]);
  }

  for (const ids of chunk([...byRecipient.keys()], RECIPIENT_BATCH)) {
    const [{ data: subs, error: subsError }, { data: prefs }] = await Promise.all([
      admin
        .from('push_subscriptions')
        .select('id, profile_id, endpoint, p256dh, auth, failure_count')
        .in('profile_id', ids),
      admin.from('notification_preferences').select('user_id, push_enabled').in('user_id', ids),
    ]);
    if (subsError) {
      if (isMissingSchema(subsError.code)) return { ...result, skipped: 'needs_248' };
      throw subsError;
    }
    const switchedOff = new Set(
      ((prefs ?? []) as Array<{ user_id: string; push_enabled: boolean | null }>)
        .filter(p => p.push_enabled === false)
        .map(p => p.user_id)
    );
    const devices = new Map<string, PushSubscriptionRow[]>();
    for (const sub of (subs ?? []) as PushSubscriptionRow[]) {
      if (switchedOff.has(sub.profile_id)) continue;
      const list = devices.get(sub.profile_id);
      if (list) list.push(sub);
      else devices.set(sub.profile_id, [sub]);
    }

    for (const [recipient, recipientDevices] of devices) {
      result.recipients += 1;
      try {
        const { count } = await admin
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', recipient)
          .eq('is_read', false);
        const toSend = rowsToSend(byRecipient.get(recipient) ?? []).slice(0, MAX_PUSHES_PER_RECIPIENT);
        // Oldest first, so the newest lands on top of the device's list.
        for (const row of toSend.reverse()) {
          const payload = pushPayloadFor(row, count ?? 0);
          for (const device of recipientDevices) {
            const outcome = await sendToSubscription(admin, vapid, device, payload);
            result[outcome === 'sent' ? 'sent' : outcome === 'gone' ? 'gone' : 'failed'] += 1;
          }
        }
      } catch (error) {
        console.error('[PUSH] recipient failed:', error);
        result.failed += 1;
      }
    }
  }
  return result;
}
