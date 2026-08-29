// Pure core of the notification channel dispatcher (Wave 7): types + the
// channel-resolution rule, no framework or nodemailer imports so the
// node-only vitest suite can cover it (the rate-limit-core pattern). The
// server glue that talks to real channels lives in ./dispatch.ts and
// re-exports everything here.
//
// WHY THIS EXISTS: until Wave 7, email was hardcoded at every
// notification-driven send site, so adding a channel (SMS is the intended
// one) meant touching each of them. Now the send sites describe WHAT to
// deliver (a typed payload) and this layer decides WHERE. Provisioning SMS
// later means: a migration adding the preference column(s) + Zod allowlist
// entries, a provider adapter in dispatch.ts, and one line in
// resolveChannels — zero send-site changes. Until then 'sms' resolves to
// nothing, with the reason recorded in DeliveryResult when asked.

export type Channel = 'email' | 'sms';

/** Which preference boolean gates email for this send. */
export type NotifyTier = 'urgent' | 'digest';

/**
 * The tier-relevant slice of notification_preferences. Semantics mirror the
 * live columns: urgent_email_enabled defaults TRUE (a guardian who never
 * opened settings still gets safety mail — migration 135), email_enabled
 * defaults FALSE (the digest is opt-in).
 */
export interface ChannelPrefs {
  emailEnabled?: boolean;
  urgentEmailEnabled?: boolean;
}

/** What a send site wants delivered — one entry per email-service shape. */
export type NotifyPayload =
  | { kind: 'urgent_alert'; items: Array<{ title: string; message?: string | null; path?: string | null }> }
  | { kind: 'guardian_digest'; groups: Array<{ childName: string | null; items: Array<{ title: string }> }> }
  | { kind: 'child_digest'; childFirstName: string; items: Array<{ title: string; created_at: string }> };

export interface NotifyRecipient {
  email: string | null;
  displayName: string;
  // phone lands here when SMS is provisioned (profiles.phone exists but is
  // deliberately unread until a provider + verification story exist).
}

export interface DeliveryResult {
  channel: Channel;
  sent: boolean;
  /** Why nothing went out: 'unprovisioned' (sms today), 'no_address', 'send_failed'. */
  reason?: string;
}

/**
 * The channel decision. Email follows the tier's preference boolean with
 * the live defaults; SMS is unconditionally off until provisioned.
 */
export function resolveChannels(tier: NotifyTier, prefs: ChannelPrefs): Channel[] {
  const channels: Channel[] = [];
  const emailOn =
    tier === 'urgent' ? prefs.urgentEmailEnabled !== false : prefs.emailEnabled === true;
  if (emailOn) channels.push('email');
  return channels;
}

/** Did the email channel deliver? (The watermark/stamp question today.) */
export function emailDelivered(results: DeliveryResult[]): boolean {
  return results.some(r => r.channel === 'email' && r.sent);
}
