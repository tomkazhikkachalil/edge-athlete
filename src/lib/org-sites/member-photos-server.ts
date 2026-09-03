// ── Member round photos — the SERVER half (M2, program 10) ──────────────────
// listMemberPhotoCandidates: what a MANAGER may pick from — the photos on
// PUBLIC golf round posts (last 90 days) by consenting, public,
// unsupervised members, with the current picks marked. Thumbnails ride
// the signed proxy (the manager is signed in; nothing here is public).
// The site gate (member-photo-gate.ts) re-decides every one of these at
// read time — this list is a browsing aid, not an authorization.

import type { SupabaseClient } from '@supabase/supabase-js';
import { toProxyUrl } from '@/lib/media/proxy-url';
import type { OrgSide } from '@/lib/orgs/authz';
import { isPublicProfile, publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { readGalleryPicks } from './member-photo-gate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const CANDIDATE_DAYS = 90;
const POSTS_CAP = 200;

export interface MemberPhotoCandidate {
  mediaId: string;
  postId: string;
  profileId: string;
  authorName: string;
  url: string; // the signed proxy URL (manager-only)
  width: number | null;
  height: number | null;
  date: string | null;
  courseName: string | null;
  picked: boolean;
}

export async function listMemberPhotoCandidates(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  siteId: string
): Promise<{ candidates: MemberPhotoCandidate[]; picks: number }> {
  const orgCol = side === 'league' ? 'league_id' : 'club_id';
  const { data: mod } = await admin
    .from('org_site_modules')
    .select('config')
    .eq('site_id', siteId)
    .eq('module_key', 'gallery')
    .maybeSingle();
  const picks = readGalleryPicks(mod?.config);
  const picked = new Set(picks.map(p => p.mediaId));

  const { data: grants, error: grantsError } = await admin
    .from('memberships')
    .select('profile_id')
    .eq(orgCol, orgId)
    .eq('kind', 'follow')
    .eq('scope_type', 'org')
    .eq('status', 'active')
    .eq('photo_consent', true)
    .limit(2000);
  if (grantsError || !grants || grants.length === 0) return { candidates: [], picks: picks.length };
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, first_name, last_name, full_name, visibility, email, supervision_state')
    .in('id', grants.map(g => g.profile_id as string));
  const authors = new Map<string, string>();
  for (const p of (profiles ?? []) as (MaskableProfile & { id: string })[]) {
    if (isPublicProfile(p)) authors.set(p.id, publicDisplayName(p));
  }
  if (authors.size === 0) return { candidates: [], picks: picks.length };

  const since = new Date(Date.now() - CANDIDATE_DAYS * 86_400_000).toISOString();
  const { data: posts } = await admin
    .from('posts')
    .select('id, profile_id, status, round_id, created_at')
    .in('profile_id', [...authors.keys()])
    .eq('visibility', 'public')
    .eq('sport_key', 'golf')
    .not('round_id', 'is', null)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(POSTS_CAP);
  const livePosts = (posts ?? []).filter(p => p.status == null || p.status === 'published');
  if (livePosts.length === 0) return { candidates: [], picks: picks.length };
  const postById = new Map(livePosts.map(p => [p.id as string, { profileId: p.profile_id as string, roundId: p.round_id as string }]));

  const { data: media } = await admin
    .from('post_media')
    .select('id, post_id, media_url, media_type, width, height, display_order')
    .in('post_id', [...postById.keys()])
    .eq('media_type', 'image')
    .order('display_order', { ascending: true })
    .limit(600);
  if (!media || media.length === 0) return { candidates: [], picks: picks.length };

  const roundIds = [...new Set([...postById.values()].map(p => p.roundId))];
  const { data: rounds } = await admin.from('golf_rounds').select('id, date, course, course_id').in('id', roundIds);
  const courseIds = [...new Set((rounds ?? []).map(r => r.course_id as string | null).filter((id): id is string => !!id))];
  const { data: courses } = courseIds.length
    ? await admin.from('golf_courses').select('id, name, club_name').in('id', courseIds)
    : { data: [] as { id: string; name: string; club_name: string | null }[] };
  const courseName = new Map((courses ?? []).map(c => [c.id as string, (c.club_name as string | null) ?? (c.name as string)]));
  const roundById = new Map(
    (rounds ?? []).map(r => [
      r.id as string,
      {
        date: typeof r.date === 'string' ? r.date : null,
        courseName:
          (typeof r.course_id === 'string' ? courseName.get(r.course_id) : undefined) ??
          (typeof r.course === 'string' && r.course ? (r.course as string) : null),
      },
    ])
  );

  const order = new Map([...postById.keys()].map((id, i) => [id, i]));
  const candidates: MemberPhotoCandidate[] = [];
  for (const m of media) {
    const post = postById.get(m.post_id as string);
    if (!post) continue;
    const url = toProxyUrl(m.media_url as string, { type: 'post', id: m.post_id as string });
    if (!url) continue;
    const round = roundById.get(post.roundId);
    candidates.push({
      mediaId: m.id as string,
      postId: m.post_id as string,
      profileId: post.profileId,
      authorName: authors.get(post.profileId) ?? 'Member',
      url,
      width: typeof m.width === 'number' ? m.width : null,
      height: typeof m.height === 'number' ? m.height : null,
      date: round?.date ?? null,
      courseName: round?.courseName ?? null,
      picked: picked.has(m.id as string),
    });
  }
  candidates.sort((a, b) => (order.get(a.postId) ?? 0) - (order.get(b.postId) ?? 0));
  return { candidates, picks: picks.length };
}
