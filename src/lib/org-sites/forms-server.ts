import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { formPurgeCutoffs, type FormsPatchInput } from './forms';

// ── The site's inbox — program 2, D2 (Sep 11 2026) ─────────────────────────
// org_site_form_submissions is posture A (service-role only); both route
// twins wrap these under requireOrgManager(manage_site). Two states: open
// (unarchived, read or not) and archived. The daily cron purges by age.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;
const TAG = '[SITE FORMS INBOX]';
const FIELDS = 'id, kind, fields, page_path, created_at, read_at, archived_at';
const LIST_MAX = 200;

async function siteIdFor(admin: Admin, side: OrgSide, orgId: string): Promise<string | null> {
  const { data } = await admin.from('org_sites').select('id').eq(side === 'league' ? 'league_id' : 'club_id', orgId).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

export interface InboxRow {
  id: string;
  kind: 'contact' | 'interest';
  fields: Record<string, unknown>;
  pagePath: string | null;
  createdAt: string;
  readAt: string | null;
  archivedAt: string | null;
}

export async function formsGET(admin: Admin, side: OrgSide, orgId: string, state: 'open' | 'archived'): Promise<NextResponse> {
  const siteId = await siteIdFor(admin, side, orgId);
  if (!siteId) return NextResponse.json({ submissions: [], unread: 0 });
  let query = admin.from('org_site_form_submissions').select(FIELDS).eq('site_id', siteId).order('created_at', { ascending: false }).limit(LIST_MAX);
  query = state === 'archived' ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  const [{ data, error }, unreadRes] = await Promise.all([query, admin.from('org_site_form_submissions').select('id', { count: 'exact', head: true }).eq('site_id', siteId).is('archived_at', null).is('read_at', null)]);
  if (error) {
    // Pre-187: the table is missing — an empty inbox, never a 500.
    if (error.code === '42P01') return NextResponse.json({ submissions: [], unread: 0, supported: false });
    console.error(`${TAG} list error:`, error);
    return NextResponse.json({ error: 'Failed to load the inbox' }, { status: 500 });
  }
  const submissions: InboxRow[] = ((data ?? []) as Record<string, unknown>[]).map(r => ({
    id: r.id as string,
    kind: r.kind === 'interest' ? 'interest' : 'contact',
    fields: (r.fields as Record<string, unknown>) ?? {},
    pagePath: (r.page_path as string | null) ?? null,
    createdAt: r.created_at as string,
    readAt: (r.read_at as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
  }));
  return NextResponse.json({ submissions, unread: unreadRes.count ?? 0, supported: true });
}

export async function formsPATCH(admin: Admin, side: OrgSide, orgId: string, input: FormsPatchInput): Promise<NextResponse> {
  const siteId = await siteIdFor(admin, side, orgId);
  if (!siteId) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if (input.read !== undefined) patch.read_at = input.read ? now : null;
  if (input.archived !== undefined) {
    patch.archived_at = input.archived ? now : null;
    if (input.archived) patch.read_at = now; // archiving reads it
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  const { data, error } = await admin.from('org_site_form_submissions').update(patch).eq('id', input.id).eq('site_id', siteId).select('id');
  if (error) {
    console.error(`${TAG} patch error:`, error);
    return NextResponse.json({ error: 'Failed to update the submission' }, { status: 500 });
  }
  if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** The daily purge: archived rows past 365 days, unarchived past 730. */
export async function runFormSubmissionPurge(admin: Admin, now = new Date()): Promise<{ ok: boolean; archived: number; open: number }> {
  const cut = formPurgeCutoffs(now);
  const archived = await admin.from('org_site_form_submissions').delete().not('archived_at', 'is', null).lt('archived_at', cut.archivedBefore).select('id');
  const open = await admin.from('org_site_form_submissions').delete().is('archived_at', null).lt('created_at', cut.openBefore).select('id');
  if (archived.error?.code === '42P01' || open.error?.code === '42P01') return { ok: true, archived: 0, open: 0 }; // pre-187
  if (archived.error || open.error) {
    console.error(`${TAG} purge error:`, archived.error ?? open.error);
    return { ok: false, archived: 0, open: 0 };
  }
  return { ok: true, archived: archived.data?.length ?? 0, open: open.data?.length ?? 0 };
}
