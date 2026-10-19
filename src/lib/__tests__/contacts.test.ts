import { describe, expect, it } from 'vitest';
import {
  CONTACT_SOURCES,
  CSV_COLUMNS,
  MARKETING_CONSENT_TEXT,
  REPEAT_MAIL_WINDOW_MS,
  contactMailBody,
  contactSubject,
  contactsCsv,
  csvEscape,
  dedupeByEmail,
  marketingList,
  shouldMailRepeat,
  type ContactRow,
} from '../contacts/rules';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const row = (over: Partial<ContactRow>): ContactRow => ({
  id: 'x',
  email: 'a@b.ca',
  name: null,
  source: 'notify_signup',
  message: null,
  marketing_consent: false,
  consent_text: null,
  user_type: null,
  created_at: '2026-10-19T10:00:00.000Z',
  ...over,
});

describe('csvEscape', () => {
  it('quotes commas, quotes and line breaks; doubles quotes', () => {
    expect(csvEscape('plain')).toBe('plain');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('two\nlines')).toBe('"two\nlines"');
  });
  it('neutralises a cell that would run as a formula', () => {
    for (const bad of ['=HYPERLINK("x")', '+1', '-1', '@cmd', '\tx']) {
      expect(csvEscape(bad).replace(/^"/, '').startsWith("'")).toBe(true);
    }
  });
  it('spells booleans and empties', () => {
    expect(csvEscape(true)).toBe('yes');
    expect(csvEscape(false)).toBe('no');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('contactsCsv', () => {
  it('writes the header and one line per row, CRLF-terminated', () => {
    const csv = contactsCsv([row({ name: 'Tom, Jr.', message: 'Hi' })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines[1]).toBe('2026-10-19T10:00:00.000Z,"Tom, Jr.",a@b.ca,notify_signup,,no,Hi');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('dedupeByEmail / marketingList', () => {
  it('keeps one row per email, the latest facts, newest first', () => {
    const out = dedupeByEmail([
      row({ id: '1', email: 'a@b.ca', name: 'A', created_at: '2026-10-01T00:00:00Z' }),
      row({ id: '2', email: 'a@b.ca', name: null, source: 'inquiry', message: 'Q?', created_at: '2026-10-02T00:00:00Z' }),
      row({ id: '3', email: 'c@d.ca', created_at: '2026-10-03T00:00:00Z' }),
    ]);
    expect(out.map(r => r.email)).toEqual(['c@d.ca', 'a@b.ca']);
    const a = out[1];
    expect(a.name).toBe('A');
    expect(a.message).toBe('Q?');
    expect(a.created_at).toBe('2026-10-02T00:00:00Z');
  });
  it('consent follows the latest submission that showed the checkbox', () => {
    const ticked = row({ email: 'a@b.ca', marketing_consent: true, consent_text: MARKETING_CONSENT_TEXT, created_at: '2026-10-01T00:00:00Z' });
    const noBox = row({ email: 'a@b.ca', marketing_consent: false, consent_text: null, created_at: '2026-10-02T00:00:00Z' });
    const unticked = row({ email: 'a@b.ca', marketing_consent: false, consent_text: MARKETING_CONSENT_TEXT, created_at: '2026-10-03T00:00:00Z' });
    expect(dedupeByEmail([ticked, noBox])[0].marketing_consent).toBe(true);
    expect(dedupeByEmail([ticked, noBox, unticked])[0].marketing_consent).toBe(false);
    expect(marketingList([ticked, noBox]).length).toBe(1);
    expect(marketingList([ticked, unticked]).length).toBe(0);
  });
});

describe('the mail', () => {
  it('mails a repeat at most once per window', () => {
    const now = Date.parse('2026-10-19T12:00:00Z');
    expect(shouldMailRepeat(null, now)).toBe(true);
    expect(shouldMailRepeat('2026-10-19T11:00:00Z', now)).toBe(false);
    expect(shouldMailRepeat(new Date(now - REPEAT_MAIL_WINDOW_MS).toISOString(), now)).toBe(true);
    expect(shouldMailRepeat('garbage', now)).toBe(true);
  });
  it('names the person in the subject, falls back to the address', () => {
    expect(contactSubject('inquiry', 'Pat', 'p@x.ca')).toBe('New inquiry: Pat');
    expect(contactSubject('notify_signup', '  ', 'p@x.ca')).toBe('New sign-up: p@x.ca');
  });
  it('the body carries the five facts and the message only when written', () => {
    const body = contactMailBody({ source: 'inquiry', name: 'Pat', email: 'p@x.ca', date: '2026-10-19', message: 'Hello', marketingConsent: true, userType: 'club' });
    for (const s of ['Name: Pat', 'Email: p@x.ca', 'Date: 2026-10-19', 'Source: Inquiry (club)', 'Marketing emails: agreed', 'Message:\nHello']) expect(body).toContain(s);
    expect(contactMailBody({ source: 'notify_signup', name: null, email: 'p@x.ca', date: 'd', message: null, marketingConsent: false })).not.toContain('Message:');
  });
});

describe('migration 266 agrees with the rules', () => {
  const sql = readFileSync(resolve(__dirname, '../../../database/migrations/266_contacts.sql'), 'utf8');
  it('pins the same sources and keeps the tables server-only', () => {
    for (const s of CONTACT_SOURCES) expect(sql).toContain(`'${s}'`);
    expect(sql).toContain('ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY');
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).toContain("VALUES (266, '266_contacts.sql')");
  });
});

describe('the consent words are one sentence everywhere', () => {
  it('COPY.CONTACTS.CONSENT_LABEL equals MARKETING_CONSENT_TEXT', async () => {
    const { COPY } = await import('../copy');
    expect(COPY.CONTACTS.CONSENT_LABEL).toBe(MARKETING_CONSENT_TEXT);
  });
});
