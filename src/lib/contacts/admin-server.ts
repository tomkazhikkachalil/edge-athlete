/**
 * The admin console's reads of the contact list (266). Read-only; the
 * writer stays `contacts-server.ts recordContact`. Every read is capped.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { CONTACTS_EXPORT_MAX, CONTACTS_PAGE_SIZE, searchPattern, type ContactRow, type ContactsFilter } from './rules';

const NOT_LIVE_CODES = new Set(['42P01', 'PGRST205']);
const COLUMNS = 'id, email, name, source, message, marketing_consent, consent_text, user_type, created_at';

export interface ContactsPage {
  supported: boolean;
  rows: ContactRow[];
  total: number;
  page: number;
  pageSize: number;
  /** The whole list's counts, unfiltered — the tile and the header read them. */
  counts: { all: number; signups: number; inquiries: number; consented: number };
}

export async function listContacts(admin: SupabaseClient, filter: ContactsFilter): Promise<ContactsPage> {
  const page = Math.max(1, Math.floor(filter.page || 1));
  const from = (page - 1) * CONTACTS_PAGE_SIZE;
  let q = admin.from('contacts').select(COLUMNS, { count: 'exact' }).order('created_at', { ascending: false }).range(from, from + CONTACTS_PAGE_SIZE - 1);
  if (filter.source) q = q.eq('source', filter.source);
  if (filter.consent === true) q = q.eq('marketing_consent', true);
  if (filter.consent === false) q = q.eq('marketing_consent', false);
  if (filter.q && filter.q.trim()) {
    const p = searchPattern(filter.q);
    q = q.or(`email.ilike.${p},name.ilike.${p}`);
  }
  const [pageRes, allRes, signupRes, inquiryRes, consentedRes] = await Promise.all([
    q,
    admin.from('contacts').select('id', { count: 'exact', head: true }),
    admin.from('contacts').select('id', { count: 'exact', head: true }).eq('source', 'notify_signup'),
    admin.from('contacts').select('id', { count: 'exact', head: true }).eq('source', 'inquiry'),
    admin.from('contacts').select('id', { count: 'exact', head: true }).eq('marketing_consent', true),
  ]);
  if (pageRes.error) {
    if (NOT_LIVE_CODES.has(pageRes.error.code)) {
      return { supported: false, rows: [], total: 0, page, pageSize: CONTACTS_PAGE_SIZE, counts: { all: 0, signups: 0, inquiries: 0, consented: 0 } };
    }
    throw new Error(`listContacts failed: ${pageRes.error.message}`);
  }
  return {
    supported: true,
    rows: (pageRes.data ?? []) as ContactRow[],
    total: pageRes.count ?? 0,
    page,
    pageSize: CONTACTS_PAGE_SIZE,
    counts: {
      all: allRes.count ?? 0,
      signups: signupRes.count ?? 0,
      inquiries: inquiryRes.count ?? 0,
      consented: consentedRes.count ?? 0,
    },
  };
}

/** Every row, newest first, capped at CONTACTS_EXPORT_MAX; `truncated` says when the file is a floor. */
export async function allContactsForExport(admin: SupabaseClient): Promise<{ rows: ContactRow[]; truncated: boolean }> {
  const { data, error } = await admin.from('contacts').select(COLUMNS).order('created_at', { ascending: false }).limit(CONTACTS_EXPORT_MAX + 1);
  if (error) throw new Error(`allContactsForExport failed: ${error.message}`);
  const rows = (data ?? []) as ContactRow[];
  return { rows: rows.slice(0, CONTACTS_EXPORT_MAX), truncated: rows.length > CONTACTS_EXPORT_MAX };
}
