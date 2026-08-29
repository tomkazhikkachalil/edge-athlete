import { emailService } from '@/lib/email-service';
import {
  resolveChannels,
  type Channel,
  type ChannelPrefs,
  type DeliveryResult,
  type NotifyPayload,
  type NotifyRecipient,
  type NotifyTier,
} from './dispatch-core';

export * from './dispatch-core';

// Server half of the channel dispatcher (Wave 7) — the adapter registry.
// Send sites (the urgent sweep, both digest paths) call dispatch() instead
// of emailService directly; transactional mail (invites, activation,
// transfer codes, contact) deliberately stays on emailService — those are
// not preference-gated notification sends and converting them buys nothing.

type ChannelAdapter = (
  recipient: NotifyRecipient,
  payload: NotifyPayload,
  appUrl: string
) => Promise<DeliveryResult>;

const emailAdapter: ChannelAdapter = async (recipient, payload, appUrl) => {
  if (!recipient.email) return { channel: 'email', sent: false, reason: 'no_address' };
  let ok = false;
  switch (payload.kind) {
    case 'urgent_alert':
      ok = await emailService.sendUrgentAlert(recipient.email, recipient.displayName, payload.items, appUrl);
      break;
    case 'guardian_digest':
      ok = await emailService.sendGuardianDigest(recipient.email, recipient.displayName, payload.groups, appUrl);
      break;
    case 'child_digest':
      ok = await emailService.sendChildDigest(recipient.email, payload.childFirstName, payload.items, appUrl);
      break;
  }
  return { channel: 'email', sent: ok, ...(ok ? {} : { reason: 'send_failed' }) };
};

// Typed stub: becomes a real provider adapter when SMS is provisioned.
// resolveChannels never selects 'sms' today, so this only runs if that
// changes — and then answers honestly rather than pretending.
const smsAdapter: ChannelAdapter = async () => ({
  channel: 'sms',
  sent: false,
  reason: 'unprovisioned',
});

const ADAPTERS: Record<Channel, ChannelAdapter> = {
  email: emailAdapter,
  sms: smsAdapter,
};

/**
 * Deliver one payload to one recipient over every channel their preferences
 * enable for the tier. Never throws — a channel failure is a result row.
 */
export async function dispatch(opts: {
  tier: NotifyTier;
  payload: NotifyPayload;
  recipient: NotifyRecipient;
  prefs: ChannelPrefs;
  appUrl: string;
}): Promise<DeliveryResult[]> {
  const channels = resolveChannels(opts.tier, opts.prefs);
  const results: DeliveryResult[] = [];
  for (const channel of channels) {
    try {
      results.push(await ADAPTERS[channel](opts.recipient, opts.payload, opts.appUrl));
    } catch (err) {
      console.error(`[notify] ${channel} adapter threw:`, err);
      results.push({ channel, sent: false, reason: 'send_failed' });
    }
  }
  return results;
}
