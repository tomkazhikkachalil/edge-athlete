import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { HONEYPOT_FIELD, formKindOf, parseFormFields, submissionSummary, verifyFormToken } from '@/lib/org-sites/forms';
import { isFormWidgetKey } from '@/lib/site-builder/catalog';
import { loadSnapshotByRevisionId } from '@/lib/org-sites/revisions-server';
import { parseStoredLayout } from '@/lib/site-builder/layout-schema';
import { orderedPages } from '@/lib/site-builder/pages';
import { siteBasePath } from '@/lib/org-sites/urls';
import { emailService } from '@/lib/email-service';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── POST /api/public/site-forms/[siteId]/[widgetId] — a visitor's form ──────
// Program 2, D (Sep 11 2026). No session (the public site is anonymous);
// form-encoded (a native <form>). Order: the honeypot (a bot's success —
// nothing stored), the per-IP bucket and the per-site day cap, the site
// (live only) and the widget (a form widget on the PUBLISHED layout — home
// or a page; unknown = 404), the form key, the fields, the insert, the notifications to
// the org's owner and managers, the owner's email when SMTP is configured.
// Every outcome is a 303 back to the page the form sat on (the same-origin
// Referer, else the site home) at #sent-<id> or #error-<id>.

const TAG = '[SITE FORMS]';
const WIDGET_ID_RE = /^[A-Za-z0-9_:.-]{1,64}$/;

interface SiteRow {
  id: string;
  league_id: string | null;
  club_id: string | null;
  subdomain: string;
  custom_domain?: string | null;
  domain_active_at?: string | null;
  published_at: string | null;
  published_revision_id: string | null;
}

async function loadSite(admin: ReturnType<typeof getSupabaseAdmin>, siteId: string): Promise<SiteRow | null> {
  const full = await admin.from('org_sites').select('id, league_id, club_id, subdomain, custom_domain, domain_active_at, published_at, published_revision_id').eq('id', siteId).maybeSingle();
  if (!full.error) return (full.data as SiteRow | null) ?? null;
  if (full.error.code !== '42703') return null;
  const base = await admin.from('org_sites').select('id, league_id, club_id, subdomain, published_at, published_revision_id').eq('id', siteId).maybeSingle();
  return (base.data as SiteRow | null) ?? null;
}

/** Back to the page the form sat on: the same-origin Referer under this
 *  site's base path, else the site home. Never an outside URL. */
function returnPath(request: NextRequest, site: SiteRow): string {
  const base = siteBasePath(site) || '/';
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      const origin = new URL(request.url).origin;
      if (url.origin === origin && (url.pathname === base || url.pathname.startsWith(base === '/' ? '/' : `${base}/`)) && !url.pathname.includes('/preview/')) {
        return url.pathname;
      }
    } catch {
      /* fall through */
    }
  }
  return base;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ siteId: string; widgetId: string }> }) {
  const { siteId, widgetId } = await params;
  const bad = () => NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!UUID_RE.test(siteId) || !WIDGET_ID_RE.test(widgetId)) return bad();
  const admin = getSupabaseAdmin();
  const site = await loadSite(admin, siteId);
  if (!site || !site.published_at) return bad();
  const back = returnPath(request, site);
  const to = (hash: 'sent' | 'error') => NextResponse.redirect(new URL(`${back}#${hash}-${widgetId}`, request.url), 303);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return to('error');
  }
  const raw: Record<string, unknown> = {};
  for (const [k, v] of form.entries()) if (typeof v === 'string') raw[k] = v;

  // The honeypot: a bot's "success" — nothing stored, nothing counted.
  if (typeof raw[HONEYPOT_FIELD] === 'string' && raw[HONEYPOT_FIELD].trim() !== '') return to('sent');

  const limited = (await enforceRateLimit(request, 'site-form')) ?? (await enforceRateLimit(request, 'site-form-site', { userId: site.id }));
  if (limited) return to('error');

  // The widget must be a form on the PUBLISHED layout — home or a page.
  const snapshot = site.published_revision_id ? await loadSnapshotByRevisionId(admin, site.published_revision_id) : null;
  if (!snapshot) return bad();
  const layouts = [parseStoredLayout(snapshot.layout), ...orderedPages(snapshot.pages).map(p => parseStoredLayout(p.layout))];
  const widget = layouts.flatMap(l => l?.widgets ?? []).find(w => w.id === widgetId);
  if (!widget || !isFormWidgetKey(widget.key)) return bad();
  const kind = formKindOf(widget.key);

  // The form key AFTER the widget: an unknown widget is a plain 404 (it
  // leaks nothing), a known one without our key is refused.
  if (!verifyFormToken(site.id, widgetId, typeof raw.t === 'string' ? raw.t : null)) return to('error');

  const fields = parseFormFields(kind, raw);
  if (!fields) return to('error');

  const { data: inserted, error } = await admin
    .from('org_site_form_submissions')
    .insert({ site_id: site.id, kind, fields, page_path: back })
    .select('id')
    .single();
  if (error || !inserted) {
    console.error(`${TAG} insert error:`, error);
    return to('error');
  }

  // The org's owner and managers hear (best effort); the owner gets an email
  // when SMTP is configured. The notification carries a summary — never the
  // message body — and a door to the console's inbox.
  try {
    const side = site.league_id ? 'league' : 'club';
    const orgId = (site.league_id ?? site.club_id) as string;
    const col = side === 'league' ? 'league_id' : 'club_id';
    const [{ data: org }, { data: members }] = await Promise.all([
      admin.from(side === 'league' ? 'leagues' : 'clubs').select('id, name, owner_profile_id').eq('id', orgId).maybeSingle(),
      admin.from('memberships').select('profile_id, role').eq(col, orgId).in('role', ['owner', 'manager', 'admin']),
    ]);
    const ownerId = (org as { owner_profile_id?: string | null } | null)?.owner_profile_id ?? null;
    const recipients = new Set<string>([...(ownerId ? [ownerId] : []), ...((members ?? []) as { profile_id: string }[]).map(m => m.profile_id)]);
    const orgName = (org as { name?: string } | null)?.name ?? 'your organization';
    const summary = submissionSummary(kind, fields);
    if (recipients.size > 0) {
      const rows = [...recipients].map(user_id => ({
        user_id,
        type: 'site_form_submission',
        actor_id: null,
        title: summary,
        message: `${kind === 'contact' ? 'Contact' : 'Interest'} form on the ${orgName} site — read it in the console.`,
        action_url: `/app/org/${side}/${orgId}#inbox`,
        is_read: false,
        metadata: { org: `${side}:${orgId}`, submission_id: inserted.id, form_kind: kind },
      }));
      const { error: notifyError } = await admin.from('notifications').insert(rows);
      if (notifyError) console.error(`${TAG} notify error:`, notifyError);
    }
    if (ownerId && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const { data: owner } = await admin.from('profiles').select('email').eq('id', ownerId).maybeSingle();
      const ownerEmail = (owner as { email?: string | null } | null)?.email ?? null;
      if (ownerEmail) await emailService.sendSiteFormEmail({ to: ownerEmail, orgName, kind, fields, consoleUrl: `/app/org/${side}/${orgId}#inbox` });
    }
  } catch (e) {
    console.error(`${TAG} notify failed:`, e);
  }
  return to('sent');
}
