import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { getOrgAndRole } from '@/lib/orgs/authz';
import { parsePageBody } from '@/lib/org-sites/validate';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/clubs/[id]/news/mine — the MEMBERS' news read (phase 9 V5) ────────
// A private club's site lists public posts only; members read every
// published post (public and members-only) here — session-gated, private
// cache — and the in-app club page draws them. The body is the parsed
// block list (parsePageBody: malformed blocks dropped, never throws).

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    const admin = getSupabaseAdmin();
    const loaded = await getOrgAndRole(admin, 'club', id, user.id);
    if (loaded.status !== 'found') return NextResponse.json({ error: 'Club not found' }, { status: 404 });
    if (!loaded.role && loaded.org.owner_profile_id !== user.id) {
      return NextResponse.json({ error: 'Members only' }, { status: 403 });
    }
    const { data: site } = await admin.from('org_sites').select('id, subdomain, published_at').eq('club_id', id).maybeSingle();
    if (!site) return NextResponse.json({ posts: [], site: null }, { headers: { 'Cache-Control': 'private, no-store' } });
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
      console.error('[CLUB NEWS] mine read error:', error);
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
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB NEWS] mine GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
