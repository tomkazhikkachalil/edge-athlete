// ── The MEMBERS' reads of a private org (phase 9 V4/V5; both sides in
// program 11 L2) ─────────────────────────────────────────────────────────
// A private org's PUBLIC standings are the empty state and its site lists
// public news only (the CDN-cached reads must stay viewer-independent).
// Members read the full payloads HERE: a separate path (never a ?scope= on
// a cached URL), session-gated, Cache-Control private / no-store — the
// golf/mine precedent. One handler per read, called by the four routes
// (/api/{leagues,clubs}/[id]/{standings,news}/mine). Each ROUTE calls
// `requireAuth` itself and hands the user in — the route-authz audit
// (api-route-authz.test.ts) wants the gate visible in every route file.

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { fetchPublicStandings } from '@/lib/competitions/public-standings';
import { parsePageBody } from '@/lib/org-sites/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { getOrgAndRole, type OrgSide } from './authz';

const PRIVATE = { 'Cache-Control': 'private, no-store' };

function notFound(side: OrgSide) {
  return NextResponse.json({ error: side === 'league' ? 'League not found' : 'Club not found' }, { status: 404 });
}

type SessionUser = { id: string };

/** A membership (or the owner column) for the already-authenticated user. */
async function memberGate(user: SessionUser, side: OrgSide, params: Promise<{ id: string }>) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { response: notFound(side) };
  const admin = getSupabaseAdmin();
  const loaded = await getOrgAndRole(admin, side, id, user.id);
  if (loaded.status !== 'found') return { response: notFound(side) };
  if (!loaded.role && loaded.org.owner_profile_id !== user.id) {
    return { response: NextResponse.json({ error: 'Members only' }, { status: 403 }) };
  }
  return { admin, id };
}

export async function standingsMineGET(user: SessionUser, side: OrgSide, params: Promise<{ id: string }>) {
  try {
    const g = await memberGate(user, side, params);
    if ('response' in g) return g.response;
    const payload = await fetchPublicStandings(g.admin, side, g.id, { membersView: true });
    if (!payload) return notFound(side);
    return NextResponse.json(payload, { headers: PRIVATE });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(`[STANDINGS] ${side} mine GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function newsMineGET(user: SessionUser, side: OrgSide, params: Promise<{ id: string }>) {
  try {
    const g = await memberGate(user, side, params);
    if ('response' in g) return g.response;
    const { admin, id } = g;
    const { data: site } = await admin
      .from('org_sites')
      .select('id, subdomain, published_at')
      .eq(side === 'league' ? 'league_id' : 'club_id', id)
      .maybeSingle();
    if (!site) return NextResponse.json({ posts: [], site: null }, { headers: PRIVATE });
    const read = (fields: string) =>
      admin
        .from('org_site_news')
        .select(fields)
        .eq('site_id', site.id)
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })
        .limit(50);
    let { data, error } = await read('id, slug, title, body, published_at, audience');
    if (error?.code === '42703') ({ data, error } = await read('id, slug, title, body, published_at'));
    if (error) {
      console.error(`[ORG NEWS] ${side} mine read error:`, error);
      return NextResponse.json({ error: 'Failed to load news' }, { status: 500 });
    }
    const posts = ((data ?? []) as unknown as Record<string, unknown>[]).map(n => ({
      id: n.id as string,
      slug: n.slug as string,
      title: n.title as string,
      publishedAt: n.published_at as string,
      audience: n.audience === 'members' ? 'members' : 'public',
      blocks: parsePageBody(n.body),
    }));
    return NextResponse.json(
      { posts, site: { id: site.id as string, subdomain: site.subdomain as string, published: !!site.published_at } },
      { headers: PRIVATE }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error(`[ORG NEWS] ${side} mine GET error:`, error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
