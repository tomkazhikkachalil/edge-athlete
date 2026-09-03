// ── Member round photos on a club site — THE gate (M2, program 10) ──────────
// Tom's policy: the MEMBER opts in ("share my round photos with this
// club"), only photos on their PUBLIC round posts are candidates, a
// MANAGER curates which go on the site; minors never, private profiles
// never. One function decides, re-run at every read: the batch reader
// (fetchPublicGallery + the player page), the pick action (before a
// pick is stored) and the per-request public streamer — so a stale ISR
// document can never out-serve it. Every miss ⇒ the item is dropped;
// nothing here throws.
//
// The five keys, in order: (1) the SITE is published and public (a
// private club's picks never stream — the phase-9 rail; the contest
// precedent checks neither, this one does); (2) the gallery module is
// on and the pick is in its config (postId/profileId in the pick are
// hints — everything is re-derived from rows); (3) the post is public,
// published, golf, on a round; (4) the author is a public, non-stub,
// UNSUPERVISED profile; (5) the author's active org-scope FOLLOW row
// carries photo_consent=true (the round-photo grant, separate from the
// roster grant). `authorizePost` (media/authorize.ts) is NOT reused: it
// ignores status and supervision.

import type { SupabaseClient } from '@supabase/supabase-js';
import { parsePublicUrl } from '@/lib/media/proxy-url';
import { isPublicProfile, publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { readClubAccess } from '@/lib/orgs/access';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export const GALLERY_PICKS_MAX = 80;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface GalleryPick {
  mediaId: string;
  postId: string;
  profileId: string;
  addedAt: string;
}

/** The gallery module's `config.picks`, defensively (pure; node-tested):
 *  uuid ids only, first occurrence wins, capped. Order = as stored
 *  (newest pick first — the writer prepends). */
export function readGalleryPicks(config: unknown): GalleryPick[] {
  const raw = (config as { picks?: unknown } | null)?.picks;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: GalleryPick[] = [];
  for (const item of raw) {
    if (out.length >= GALLERY_PICKS_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const { mediaId, postId, profileId, addedAt } = item as Record<string, unknown>;
    if (typeof mediaId !== 'string' || !UUID_RE.test(mediaId) || seen.has(mediaId)) continue;
    if (typeof postId !== 'string' || !UUID_RE.test(postId)) continue;
    if (typeof profileId !== 'string' || !UUID_RE.test(profileId)) continue;
    seen.add(mediaId);
    out.push({ mediaId, postId, profileId, addedAt: typeof addedAt === 'string' ? addedAt : '' });
  }
  return out;
}

export interface MemberPhoto {
  mediaId: string;
  postId: string;
  profileId: string;
  /** The private-bucket object key (uploads/…) for the streamer. */
  storageKey: string;
  width: number | null;
  height: number | null;
  date: string | null; // the round's date (YYYY-MM-DD)
  courseName: string | null;
  authorName: string; // publicDisplayName — the author passed isPublicProfile, so their real name
}

export interface MemberPhotoGateOptions {
  /** Default true: the media must be in the gallery module's picks. The
   *  pick action itself passes false (it is about to store the pick). */
  requirePick?: boolean;
  /** Default true: the site must be published AND public. The pick
   *  action passes false (a manager curates a draft or private site;
   *  nothing streams until the site is live and public). */
  requireLive?: boolean;
}

/** Batch-evaluate post media for a club site. Returns ONLY the eligible
 *  items, in the order of `mediaIds`. Never throws. */
export async function evaluateMemberPhotos(
  admin: Admin,
  siteId: string,
  mediaIds: string[],
  opts: MemberPhotoGateOptions = {}
): Promise<MemberPhoto[]> {
  const requirePick = opts.requirePick ?? true;
  const requireLive = opts.requireLive ?? true;
  const ids = [...new Set(mediaIds.filter(id => UUID_RE.test(id)))];
  if (ids.length === 0 || !UUID_RE.test(siteId)) return [];
  try {
    // (1) the site — published, and the CLUB public (visibility lives on
    // the clubs row, 176; readClubAccess is 42703-safe ⇒ public pre-176).
    const { data: site } = await admin
      .from('org_sites')
      .select('id, club_id, league_id, published_at')
      .eq('id', siteId)
      .maybeSingle();
    if (!site) return [];
    const orgCol = site.club_id ? 'club_id' : 'league_id';
    const orgId = (site.club_id ?? site.league_id) as string | null;
    if (!orgId) return [];
    if (requireLive) {
      if (!site.published_at) return [];
      if (site.club_id && (await readClubAccess(admin, site.club_id as string)).visibility === 'private') return [];
    }

    // (2) the picks.
    let allowed = new Set(ids);
    if (requirePick) {
      const { data: mod } = await admin
        .from('org_site_modules')
        .select('enabled, config')
        .eq('site_id', siteId)
        .eq('module_key', 'gallery')
        .maybeSingle();
      if (!mod?.enabled) return [];
      const picks = new Set(readGalleryPicks(mod.config).map(p => p.mediaId));
      allowed = new Set(ids.filter(id => picks.has(id)));
      if (allowed.size === 0) return [];
    }

    // (3) the media + the post.
    const { data: mediaRows } = await admin
      .from('post_media')
      .select('id, post_id, media_url, media_type, width, height')
      .in('id', [...allowed])
      .eq('media_type', 'image');
    if (!mediaRows || mediaRows.length === 0) return [];
    const postIds = [...new Set(mediaRows.map(m => m.post_id as string))];
    const { data: posts } = await admin
      .from('posts')
      .select('id, profile_id, visibility, status, sport_key, round_id')
      .in('id', postIds)
      .eq('visibility', 'public')
      .eq('sport_key', 'golf')
      .not('round_id', 'is', null);
    const postById = new Map(
      (posts ?? [])
        .filter(p => p.status == null || p.status === 'published')
        .map(p => [p.id as string, { profileId: p.profile_id as string, roundId: p.round_id as string }])
    );
    if (postById.size === 0) return [];

    // (4) the author.
    const profileIds = [...new Set([...postById.values()].map(p => p.profileId))];
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, first_name, last_name, full_name, visibility, email, supervision_state')
      .in('id', profileIds);
    const publicAuthor = new Map<string, string>();
    for (const p of (profiles ?? []) as (MaskableProfile & { id: string })[]) {
      if (isPublicProfile(p)) publicAuthor.set(p.id, publicDisplayName(p));
    }
    if (publicAuthor.size === 0) return [];

    // (5) the round-photo grant on the FOLLOW row.
    const { data: grants, error: grantsError } = await admin
      .from('memberships')
      .select('profile_id')
      .eq(orgCol, orgId)
      .in('profile_id', [...publicAuthor.keys()])
      .eq('kind', 'follow')
      .eq('scope_type', 'org')
      .eq('status', 'active')
      .eq('photo_consent', true);
    if (grantsError) return []; // pre-159 ⇒ nothing consented
    const consented = new Set((grants ?? []).map(g => g.profile_id as string));
    if (consented.size === 0) return [];

    // Captions: the round's course + date.
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

    const byId = new Map<string, MemberPhoto>();
    for (const m of mediaRows) {
      const post = postById.get(m.post_id as string);
      if (!post) continue;
      const authorName = publicAuthor.get(post.profileId);
      if (!authorName || !consented.has(post.profileId)) continue;
      const parsed = parsePublicUrl(m.media_url as string);
      if (!parsed || parsed.bucket !== 'uploads') continue;
      const round = roundById.get(post.roundId);
      byId.set(m.id as string, {
        mediaId: m.id as string,
        postId: m.post_id as string,
        profileId: post.profileId,
        storageKey: parsed.key,
        width: typeof m.width === 'number' ? m.width : null,
        height: typeof m.height === 'number' ? m.height : null,
        date: round?.date ?? null,
        courseName: round?.courseName ?? null,
        authorName,
      });
    }
    return ids.map(id => byId.get(id)).filter((v): v is MemberPhoto => !!v);
  } catch {
    return [];
  }
}
