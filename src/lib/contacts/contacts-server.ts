/**
 * The contact list's ONE writer and the notify-inbox setting (flow changes
 * program, item 1 — Oct 19 2026, migration 266).
 *
 *   recordContact      inserts the row, then mails the inbox — best-effort,
 *                      never fails the request (a dead mail pipe is Sentry's
 *                      to show, not the visitor's to see). A repeat from the
 *                      same address and source inside 24 h still gets its
 *                      row (history) but no second mail.
 *   notifyInboxAddress app_settings.notify_inbox_email → CONTACT_EMAIL →
 *                      EMAIL_FROM: the one setting Tom switches later from
 *                      the admin console, cached a minute.
 *
 * Pre-266 (no table): the insert answers 42P01 / PGRST205 → ContactsNotLive,
 * which the route turns into a 503 by name. The setting falls back to env.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { emailService } from '@/lib/email-service';
import { reportRouteError } from '@/lib/observability/report';
import { contactMailBody, contactSubject, shouldMailRepeat, type ContactRow, type ContactSource } from './rules';

const NOT_LIVE_CODES = new Set(['42P01', 'PGRST205']);

export class ContactsNotLive extends Error {
  constructor() {
    super('The contact list is not available yet.');
    this.name = 'ContactsNotLive';
  }
}

export interface ContactInput {
  email: string;
  name: string | null;
  source: ContactSource;
  message: string | null;
  marketingConsent: boolean;
  /** The exact words shown beside the checkbox — null when the form had none. */
  consentText: string | null;
  userType: string | null;
  userAgent: string | null;
}

export const NOTIFY_INBOX_KEY = 'notify_inbox_email';
const SETTING_TTL_MS = 60_000;
let cached: { value: string | null; source: 'setting' | 'env' | 'none'; at: number } | null = null;

/** Where sign-ups and inquiries are mailed, and where that came from. */
export type NotifyInbox = { value: string | null; source: 'setting' | 'env' | 'none' };

export async function notifyInboxAddress(admin: SupabaseClient = getSupabaseAdmin(), now = Date.now()): Promise<NotifyInbox> {
  if (cached && now - cached.at < SETTING_TTL_MS) return { value: cached.value, source: cached.source };
  let setting: string | null = null;
  const { data, error } = await admin.from('app_settings').select('value').eq('key', NOTIFY_INBOX_KEY).maybeSingle();
  if (error) {
    if (!NOT_LIVE_CODES.has(error.code)) reportRouteError('[notifyInboxAddress] read failed:', error.message);
  } else {
    setting = (data?.value ?? '').trim() || null;
  }
  const env = (process.env.CONTACT_EMAIL || process.env.EMAIL_FROM || '').trim() || null;
  cached = setting
    ? { value: setting, source: 'setting', at: now }
    : env
      ? { value: env, source: 'env', at: now }
      : { value: null, source: 'none', at: now };
  return { value: cached.value, source: cached.source };
}

/** The admin console's write; clears the cache so the next mail uses it. */
export async function writeNotifyInboxAddress(admin: SupabaseClient, value: string | null, updatedBy: string): Promise<void> {
  const { error } = await admin
    .from('app_settings')
    .upsert({ key: NOTIFY_INBOX_KEY, value, updated_at: new Date().toISOString(), updated_by: updatedBy }, { onConflict: 'key' });
  if (error) throw new Error(`writeNotifyInboxAddress failed: ${error.message}`);
  cached = null;
}

/** Test seam: forget the cached setting. */
export function resetNotifyInboxCache(): void {
  cached = null;
}

export interface RecordContactResult {
  row: ContactRow;
  /** Whether the inbox was mailed on this call (false: repeat inside 24 h, no address, no SMTP, or a send failure). */
  mailed: boolean;
}

export async function recordContact(input: ContactInput, admin: SupabaseClient = getSupabaseAdmin(), now = Date.now()): Promise<RecordContactResult> {
  const email = input.email.trim().toLowerCase();

  // The last row for this address + source decides whether to mail again.
  const last = await admin
    .from('contacts')
    .select('created_at')
    .eq('email', email)
    .eq('source', input.source)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error && NOT_LIVE_CODES.has(last.error.code)) throw new ContactsNotLive();

  const { data, error } = await admin
    .from('contacts')
    .insert({
      email,
      name: input.name?.trim() || null,
      source: input.source,
      message: input.message?.trim() || null,
      marketing_consent: input.marketingConsent,
      consent_text: input.consentText,
      user_type: input.userType,
      user_agent: input.userAgent ? input.userAgent.slice(0, 400) : null,
    })
    .select('id, email, name, source, message, marketing_consent, consent_text, user_type, created_at')
    .single();
  if (error) {
    if (NOT_LIVE_CODES.has(error.code)) throw new ContactsNotLive();
    throw new Error(`recordContact insert failed: ${error.message}`);
  }
  const row = data as ContactRow;

  let mailed = false;
  if (shouldMailRepeat(last.data?.created_at ?? null, now)) {
    try {
      mailed = await sendContactMail(row, admin);
    } catch (err) {
      reportRouteError('[recordContact] mail failed (non-fatal):', err);
    }
  }
  return { row, mailed };
}

/** The mail for one row — also the admin console's "Send a test email" (with `to` given). */
export async function sendContactMail(row: ContactRow, admin: SupabaseClient, to?: string): Promise<boolean> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return false;
  const inbox = to ?? (await notifyInboxAddress(admin)).value;
  if (!inbox) return false;
  return emailService.sendContactNotification({
    to: inbox,
    replyTo: row.email,
    subject: contactSubject(row.source, row.name, row.email),
    text: contactMailBody({
      source: row.source,
      name: row.name,
      email: row.email,
      date: row.created_at,
      message: row.message,
      marketingConsent: row.marketing_consent,
      userType: row.user_type,
    }),
  });
}
