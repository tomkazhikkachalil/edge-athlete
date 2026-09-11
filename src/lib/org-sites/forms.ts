/**
 * Site forms — program 2, D (Sep 11 2026). Two FIXED forms as widgets
 * (`contact_form`, `interest_form`): the public page renders a native
 * <form> (no JavaScript — the (public) segment is server-only), the POST
 * lands on /api/public/site-forms/[siteId]/[widgetId], and a 303 sends the
 * visitor back to the page at #sent-<id> (a :target rule shows the line).
 *
 * Anti-abuse without state at render time (the page is ISR-cached, so a
 * timestamped token would expire in the cache): a honeypot field, a per-IP
 * bucket and a per-site day cap, plus a form KEY — an HMAC over the site and
 * widget ids in the same secret family as the preview token — so a POST
 * must come from a page we rendered for that widget. No secret configured
 * → no key is rendered and none is required (a supported, degraded state
 * the honeypot and the buckets still cover).
 *
 * Fields are bounded and typed here; the interest form asks an age GROUP —
 * never a date of birth (the platform's minor-data line). Pure, node-tested.
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import type { FormWidgetKey } from '@/lib/site-builder/catalog';

export type FormKind = 'contact' | 'interest';

export function formKindOf(key: FormWidgetKey): FormKind {
  return key === 'contact_form' ? 'contact' : 'interest';
}

export const AGE_GROUPS = ['U8', 'U10', 'U12', 'U14', 'U16', 'U18', 'Adult'] as const;
export type AgeGroup = (typeof AGE_GROUPS)[number];

const name = z.string().trim().min(1).max(80);
const email = z.string().trim().toLowerCase().max(200).pipe(z.email());
const message = z.string().trim().min(1).max(2000);

export const ContactFieldsSchema = z.object({ name, email, message });
export const InterestFieldsSchema = z.object({
  name,
  email,
  phone: z.string().trim().max(40).optional(),
  ageGroup: z.enum(AGE_GROUPS),
  message: z.string().trim().max(2000).optional(),
});
export type ContactFields = z.infer<typeof ContactFieldsSchema>;
export type InterestFields = z.infer<typeof InterestFieldsSchema>;
export type FormFields = ContactFields | InterestFields;

/** The posted fields for a kind, or null when they do not pass. Empty
 *  optional strings are dropped (a blank phone is no phone). */
export function parseFormFields(kind: FormKind, raw: Record<string, unknown>): FormFields | null {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v !== 'string') continue;
    if (v.trim() === '') continue;
    clean[k] = v;
  }
  const parsed = kind === 'contact' ? ContactFieldsSchema.safeParse(clean) : InterestFieldsSchema.safeParse(clean);
  return parsed.success ? parsed.data : null;
}

/** The honeypot: a field a person never sees; a filled one is a bot. */
export const HONEYPOT_FIELD = 'website';

function secrets(): string[] {
  return [process.env.MEDIA_PROXY_SECRET, process.env.MEDIA_PROXY_SECRET_PREVIOUS].filter((s): s is string => !!s);
}
function mac(secret: string, siteId: string, widgetId: string): string {
  return createHmac('sha256', secret).update(`site-form:${siteId}:${widgetId}`).digest('base64url');
}

/** The form key for a rendered widget, or null when no secret is configured. */
export function signFormToken(siteId: string, widgetId: string): string | null {
  const [current] = secrets();
  return current ? mac(current, siteId, widgetId) : null;
}

/** True when the key matches the current or previous secret — or when no
 *  secret is configured at all (nothing to verify against). */
export function verifyFormToken(siteId: string, widgetId: string, token: string | null): boolean {
  const list = secrets();
  if (list.length === 0) return true;
  if (!token) return false;
  const given = Buffer.from(token);
  return list.some(secret => {
    const expected = Buffer.from(mac(secret, siteId, widgetId));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

/** The line the org's console and notification show — never the message body. */
export function submissionSummary(kind: FormKind, fields: FormFields): string {
  const who = fields.name;
  if (kind === 'contact') return `New message from ${who}`;
  const group = 'ageGroup' in fields ? ` (${fields.ageGroup})` : '';
  return `New interest from ${who}${group}`;
}

// ── The inbox (D2) ───────────────────────────────────────────────────────────

/** A manager's inbox action: mark read, archive, or restore. */
export const FormsPatchSchema = z.object({
  id: z.uuid(),
  read: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type FormsPatchInput = z.infer<typeof FormsPatchSchema>;

/** Retention (the daily cron): archived submissions go after 365 days,
 *  unarchived ones after 730. Pure — the cron passes `now`. */
export const FORM_RETENTION_DAYS = { archived: 365, open: 730 } as const;
export function formPurgeCutoffs(now: Date): { archivedBefore: string; openBefore: string } {
  const day = 24 * 60 * 60 * 1000;
  return {
    archivedBefore: new Date(now.getTime() - FORM_RETENTION_DAYS.archived * day).toISOString(),
    openBefore: new Date(now.getTime() - FORM_RETENTION_DAYS.open * day).toISOString(),
  };
}
