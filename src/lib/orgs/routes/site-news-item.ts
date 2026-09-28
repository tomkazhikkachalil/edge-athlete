// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/site/news/[newsId] ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { NewsPatchSchema } from '@/lib/org-sites/validate';
import { newsDELETE, newsGET, newsPATCH, newsRESTORE } from '@/lib/org-sites/news-server';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';
import { recordAuthority } from '@/lib/authority/audit-server';
import { notifyNewsPost } from '@/lib/org-sites/news-notify-server';

// ── /api/{leagues,clubs}/[id]/site/news/[newsId] — one news post (phase 3 R3) ──────────

export async function siteNewsItemRouteGET(request: NextRequest, kind: OrgKind, params: { id: string; newsId: string }) {
  try {
    const user = await requireAuth(request);
    const { id, newsId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(newsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    return await newsGET(admin, kind, id, newsId);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE NEWS] ${kind} page GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteNewsItemRoutePATCH(request: NextRequest, kind: OrgKind, params: { id: string; newsId: string }) {
  try {
    const user = await requireAuth(request);
    const { id, newsId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(newsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const parsed = await parseBody(request, NewsPatchSchema);
    if (!parsed.success) return parsed.response;
    // N3: the composer's autosave (an edit, nothing else) rides its own bucket
    // — the site draft's reasoning; every other act the pages bucket.
    const autosave = parsed.data.edit !== undefined && Object.keys(parsed.data).every(k => k === 'edit' || k === 'expectUpdatedAt');
    const limited = await enforceRateLimit(request, autosave ? 'org-site-news-draft' : 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;

    if (parsed.data.restore) {
      // Authority (240): a deleted post comes back as it was.
      const res = await newsRESTORE(admin, kind, id, newsId);
      if (res.ok) {
        const { data: back } = await admin.from('org_site_news').select('title, slug').eq('id', newsId).maybeSingle();
        await recordAuthority(admin, {
          subject: { type: 'org', id },
          actor: { kind: 'member', profileId: user.id },
          action: 'news_restored',
          detail: { news_id: newsId, title: back?.title ?? null, slug: back?.slug ?? null },
        });
      }
      return res;
    }
    const res = await newsPATCH(admin, kind, id, newsId, parsed.data);
    // N3 (243): a post going live — or scheduled — is an act on the org's public face.
    if (res.ok) {
      const body = (await res.clone().json().catch(() => null)) as {
        state?: string;
        transition?: string | null;
        post?: { title?: string; slug?: string; published_at?: string; notify_members?: boolean; notified_at?: string | null };
      } | null;
      if (body?.transition === 'published' || body?.transition === 'scheduled') {
        await recordAuthority(admin, {
          subject: { type: 'org', id },
          actor: { kind: 'member', profileId: user.id },
          action: 'news_published',
          detail: { news_id: newsId, title: body.post?.title ?? null, slug: body.post?.slug ?? null, status: body.transition, after: body.post?.published_at ?? null },
        });
      }
      // A1: a LIVE post with "Notify members" on and no bells yet sends them
      // now (publish, promote, or the switch on a live post) — the claim
      // inside notifyNewsPost makes it once only. The answer carries the count
      // and the post's new notified_at.
      if (body?.state === 'live' && body.post?.notify_members && !body.post.notified_at) {
        const out = await notifyNewsPost(admin, { side: kind, orgId: id, newsId, actorId: user.id });
        if (out.status === 'sent') {
          const json = (await res.clone().json()) as { post?: Record<string, unknown> } & Record<string, unknown>;
          const { data: stamped } = await admin.from('org_site_news').select('notified_at, updated_at').eq('id', newsId).is('deleted_at', null).maybeSingle();
          return NextResponse.json({ ...json, post: { ...(json.post ?? {}), ...(stamped ?? {}) }, notified: { sent: out.sent, guardians: out.guardians } });
        }
      }
    }
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE NEWS] ${kind} page PATCH error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function siteNewsItemRouteDELETE(request: NextRequest, kind: OrgKind, params: { id: string; newsId: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'org-site-pages', { userId: user.id });
    if (limited) return limited;
    const { id, newsId } = params;
    if (!UUID_RE.test(id) || !UUID_RE.test(newsId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_site' });
    if (!gate.ok) return gate.response;
    const { data: doomed } = await admin.from('org_site_news').select('title, slug').eq('id', newsId).maybeSingle();
    const res = await newsDELETE(admin, kind, id, newsId, user.id);
    if (res.ok) {
      await recordAuthority(admin, {
        subject: { type: 'org', id },
        actor: { kind: 'member', profileId: user.id },
        action: 'news_deleted',
        detail: { news_id: newsId, title: doomed?.title ?? null, slug: doomed?.slug ?? null },
      });
    }
    return res;
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError(`[ORG SITE NEWS] ${kind} page DELETE error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
