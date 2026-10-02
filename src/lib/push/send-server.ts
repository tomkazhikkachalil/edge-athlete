import webpush from 'web-push';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deliveryUrl, type VapidConfig } from './config-server';
import type { PushPayload } from './payload';

// ── The ONE sender (mig 248) — SERVER ONLY ──────────────────────────────────
// `web-push` builds the request (the payload encrypted to the device's keys,
// the VAPID signature); we send it with fetch, so a request has a hard
// deadline and the e2e stand-in can be plain http (deliveryUrl).
//
// What a push service's answer means for the subscription row:
//   2xx       delivered → last_success_at, failure_count 0
//   404 / 410 the device unsubscribed (or the app was removed) → row deleted
//   other     a passing fault → failure_count + 1; at MAX_FAILURES the row
//             goes (a subscription that has failed five sweeps running is
//             dead in practice and would cost every sweep a timeout)

export const MAX_FAILURES = 5;
/** A day: a phone that is off overnight still gets the morning's news; older
 *  than that, the bell inside the app is the better place. */
export const PUSH_TTL_SECONDS = 86_400;
const SEND_TIMEOUT_MS = 8_000;

export interface PushSubscriptionRow {
  id: string;
  profile_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

export type SendOutcome = 'sent' | 'gone' | 'failed';

export async function sendToSubscription(
  admin: SupabaseClient,
  vapid: VapidConfig,
  subscription: PushSubscriptionRow,
  payload: PushPayload
): Promise<SendOutcome> {
  let status = 0;
  try {
    const details = webpush.generateRequestDetails(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      {
        TTL: PUSH_TTL_SECONDS,
        urgency: 'normal',
        vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      }
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const response = await fetch(deliveryUrl(details.endpoint), {
        method: details.method,
        headers: details.headers as Record<string, string>,
        body: details.body ? new Uint8Array(details.body) : undefined,
        signal: controller.signal,
      });
      status = response.status;
      await response.arrayBuffer().catch(() => undefined);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    status = 0; // a bad key on the row, a DNS failure, the deadline — a failure
  }

  if (status >= 200 && status < 300) {
    await admin
      .from('push_subscriptions')
      .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
      .eq('id', subscription.id);
    return 'sent';
  }
  if (status === 404 || status === 410 || subscription.failure_count + 1 >= MAX_FAILURES) {
    await admin.from('push_subscriptions').delete().eq('id', subscription.id);
    return 'gone';
  }
  await admin
    .from('push_subscriptions')
    .update({ failure_count: subscription.failure_count + 1 })
    .eq('id', subscription.id);
  return 'failed';
}
