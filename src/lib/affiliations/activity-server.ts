// ── Org recent activity — the shared core (connections PR D) ────────────────
// Public reads with the /u/ privacy rule: only posts that are ALREADY
// anonymous-visible (post.visibility public AND author profile public) —
// membership is public, so this surfaces nothing a visitor couldn't reach.
// Light excerpt rows on purpose: org pages stay free of PostCard/feed
// hydration machinery; each row links /feed?post=<id>.

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { isMissingTableError } from '@/lib/leagues/validate';
import { memberProfileIds } from '@/lib/orgs/members';
import { UUID_RE } from '@/lib/golf/course-catalog';

const LIMIT = 10;
const EXCERPT = 140;

export async function orgActivityGET(
  request: NextRequest,
  side: 'league' | 'club',
  orgId: string
) {
  if (!UUID_RE.test(orgId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const admin = getSupabaseAdmin();
  const { profileIds: memberIds, error: memberError } = await memberProfileIds(admin, {
    side,
    orgId,
  });
  if (memberError) {
    if (isMissingTableError(memberError.code)) return NextResponse.json({ activity: [] });
    console.error('[ORG ACTIVITY] members error:', memberError);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }
  if (memberIds.length === 0) return NextResponse.json({ activity: [] });

  // Public posts by members, newest first — over-fetch a little, the
  // owner-public filter below may drop rows.
  const { data: posts, error: postsError } = await admin
    .from('posts')
    .select('id, caption, created_at, profile_id, post_media (media_url)')
    .in('profile_id', memberIds)
    .eq('visibility', 'public')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(LIMIT * 3);
  if (postsError) {
    console.error('[ORG ACTIVITY] posts error:', postsError);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }

  const authorIds = [...new Set((posts ?? []).map(p => p.profile_id as string))];
  const { data: authors } = authorIds.length
    ? await admin
        .from('profiles')
        .select('id, visibility, first_name, last_name, full_name, avatar_url')
        .in('id', authorIds)
    : { data: [] };
  const publicAuthors = new Map(
    (authors ?? []).filter(a => a.visibility === 'public').map(a => [a.id, a])
  );

  const activity = (posts ?? [])
    .filter(p => publicAuthors.has(p.profile_id as string))
    .slice(0, LIMIT)
    .map(p => {
      const author = publicAuthors.get(p.profile_id as string)!;
      const media = (p.post_media ?? []) as Array<{ media_url: string }>;
      return {
        id: p.id,
        created_at: p.created_at,
        textExcerpt: p.caption ? String(p.caption).slice(0, EXCERPT) : null,
        thumbUrl: media[0]?.media_url ?? null,
        author: {
          id: author.id,
          first_name: author.first_name,
          last_name: author.last_name,
          full_name: author.full_name,
          avatar_url: author.avatar_url,
        },
      };
    });

  return NextResponse.json({ activity });
}
