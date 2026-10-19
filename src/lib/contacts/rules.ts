/**
 * The contact list's rules (flow changes program, item 1 — Oct 19 2026).
 * Pure, ZERO imports: the limits every door shares, the CSV the admin
 * exports, and the one-per-email marketing list. The writer is
 * `contacts-server.ts recordContact`; the route is `POST /api/contacts`.
 */

export const CONTACT_SOURCES = ['notify_signup', 'inquiry'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/** The landing page's interest types (027) plus the athlete the coming-soon form implies. */
export const CONTACT_USER_TYPES = ['club', 'league', 'fan', 'guest', 'athlete'] as const;
export type ContactUserType = (typeof CONTACT_USER_TYPES)[number];

export const CONTACT_LIMITS = {
  name: 100,
  message: 5000,
  consentText: 500,
  userAgent: 400,
} as const;

/** The words a person agrees to. The form sends them; the row keeps them (CASL: express consent, recorded). */
export const MARKETING_CONSENT_TEXT = 'Also send me Edge Athlete news and offers';

/** A repeat sign-up from the same address mails the inbox at most once in this window. */
export const REPEAT_MAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ContactRow {
  id: string;
  email: string;
  name: string | null;
  source: ContactSource;
  message: string | null;
  marketing_consent: boolean;
  consent_text: string | null;
  user_type: string | null;
  created_at: string;
}

/** The CSV's columns, in order — the header row spells them. */
export const CSV_COLUMNS = ['date', 'name', 'email', 'source', 'user_type', 'marketing_consent', 'message'] as const;

/**
 * One CSV cell (RFC 4180): quoted when it holds a comma, a quote or a line
 * break, quotes doubled — and a leading `'` when the cell would otherwise
 * start a spreadsheet formula (`=`, `+`, `-`, `@`, a tab or a CR): a contact
 * who typed `=HYPERLINK(...)` as their name must not run in Tom's sheet.
 */
export function csvEscape(value: string | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function contactsCsv(rows: readonly ContactRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      csvEscape(r.created_at),
      csvEscape(r.name),
      csvEscape(r.email),
      csvEscape(r.source),
      csvEscape(r.user_type),
      csvEscape(r.marketing_consent),
      csvEscape(r.message),
    ].join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The marketing list: one row per email, the LATEST submission's name and
 * date, and consent = the latest answer that said anything (a later
 * unticked box withdraws an earlier tick; a later form with no checkbox —
 * consent null in spirit, false in the column — does not). Callers pass
 * rows in any order.
 */
export function dedupeByEmail(rows: readonly ContactRow[]): ContactRow[] {
  const byEmail = new Map<string, ContactRow>();
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const r of sorted) {
    const prev = byEmail.get(r.email);
    if (!prev) {
      byEmail.set(r.email, { ...r });
      continue;
    }
    byEmail.set(r.email, {
      ...prev,
      ...r,
      name: r.name ?? prev.name,
      message: r.message ?? prev.message,
      user_type: r.user_type ?? prev.user_type,
      // Only a submission that showed the checkbox (consent_text present) changes the answer.
      marketing_consent: r.consent_text ? r.marketing_consent : prev.marketing_consent,
      consent_text: r.consent_text ?? prev.consent_text,
    });
  }
  return [...byEmail.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** The consented marketing list — what `?dedupe=1&consented=1` exports. */
export function marketingList(rows: readonly ContactRow[]): ContactRow[] {
  return dedupeByEmail(rows).filter(r => r.marketing_consent);
}

/** Whether a repeat from the same address within the window should mail again (never). */
export function shouldMailRepeat(lastAt: string | null, now: number): boolean {
  if (!lastAt) return true;
  const t = Date.parse(lastAt);
  if (Number.isNaN(t)) return true;
  return now - t >= REPEAT_MAIL_WINDOW_MS;
}

/** The subject line the inbox reads. */
export function contactSubject(source: ContactSource, name: string | null, email: string): string {
  const who = name && name.trim() ? name.trim() : email;
  return source === 'inquiry' ? `New inquiry: ${who}` : `New sign-up: ${who}`;
}

/** The plain-text body: the five facts, nothing else. */
export function contactMailBody(input: {
  source: ContactSource;
  name: string | null;
  email: string;
  date: string;
  message: string | null;
  marketingConsent: boolean;
  userType?: string | null;
}): string {
  const lines = [
    input.source === 'inquiry' ? 'New inquiry' : 'New notification sign-up',
    '',
    `Name: ${input.name?.trim() || '—'}`,
    `Email: ${input.email}`,
    `Date: ${input.date}`,
    `Source: ${input.source === 'inquiry' ? 'Inquiry' : 'Notification sign-up'}${input.userType ? ` (${input.userType})` : ''}`,
    `Marketing emails: ${input.marketingConsent ? 'agreed' : 'not agreed'}`,
  ];
  if (input.message && input.message.trim()) lines.push('', 'Message:', input.message.trim());
  lines.push('', '— Edge Athlete');
  return lines.join('\n');
}
