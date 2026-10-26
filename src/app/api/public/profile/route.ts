import { NextRequest, NextResponse } from 'next/server';
import { STRANGER_VIEW, getProfileOrganizations } from '@/lib/affiliations/server';
import { buildSportSkillCards } from '@/lib/sports/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { BundleUnavailableError, isFullBundleProfile, readPublicProfileBundle } from '@/lib/profiles/public-bundle';
import { isStatementPost, isTrainingPost } from '@/lib/statements';
import { toProxyUrl } from '@/lib/media/proxy-url';
import { ACTIVITY_TYPE_DEFS, isActivityType } from '@/lib/activities/catalog';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { coverProxyUrl } from '@/lib/media/cover-url';
import { aspectHidden, parseTrainingPrivacy } from '@/lib/training-privacy';
import { reportRouteError } from '@/lib/observability/report';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    // Tolerate a display-form '@handle' (and defensive double-encoding from
    // older clients passing the raw /u/@… route segment through).
    const rawHandle = searchParams.get('handle');
    const handle = rawHandle?.replace(/^(?:%40|@)+/i, '');

    if (!handle) {
      return NextResponse.json({ error: 'Handle is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // ONE read (280, trip-count program PR 1): every row this route and its
    // helpers need, raw; the rules below are unchanged. Fifteen trips became
    // one for most athletes (the official stat lines stay a live read, and
    // golf's handicap its own).
    let bundle;
    try {
      bundle = await readPublicProfileBundle(supabase, handle.toLowerCase());
    } catch (e) {
      if (e instanceof BundleUnavailableError) {
        // A deploy ahead of migration 280 on this database: say so, cache nothing.
        return NextResponse.json({ error: 'Profile service updating' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      reportRouteError('Profile fetch error:', e);
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }
    const profile = bundle.profile;
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    // Check if profile is public
    if (!isFullBundleProfile(profile) || profile.visibility !== 'public') {
      return NextResponse.json({
        error: 'Profile is private',
        isPrivate: true,
        // The id lets the private-profile page link "Become a Fan" to
        // /athlete/<id> (that route resolves UUIDs, not handles).
        profileId: profile.id
      }, { status: 403 });
    }

    // Follow stats: the trigger-maintained columns (229) — two COUNT(*)
    // over every accepted edge per view used to sit here (Round 3).
    // cover_url leaves only as its public proxy form (`cover` below) — the raw
    // bucket URL 404s since the uploads bucket went private.
    const { followers_count: followersCountCol, following_count: followingCountCol, cover_url: coverUrlCol, vitals_privacy: trainingPrivacyCol, ...profileFields } = profile;

    // Fetch posts count — media-only since the statements split (074): the
    // headline number counts portfolio posts, matching the athlete pages'
    // media-only counts.all. Statements are subtracted via the PostgREST
    // null-embed (anti-join) pattern; if that count errors it degrades to
    // subtracting 0 (total count) rather than breaking the page.
    // The three counts' predicates live in 280 now — published only (Oct 4
    // 2026), the statements anti-join, 269's training exclusion — verbatim.
    const postsCount = bundle.counts?.posts ?? 0;
    const statementsTotal = bundle.counts?.statements ?? 0;
    const trainingTotal = bundle.counts?.training ?? 0;

    // Fetch recent public posts. Over-fetch, then split into media posts
    // (the Recent Posts grid) and statements (the strip). Trade-off: if the
    // 24 most recent public posts are all statements, older media won't
    // backfill the grid — cosmetic on a teaser page, avoids a second query.
    // Published only (269) — the bundle's recent_posts carry the same
    // predicates and the same 24-row window, newest first.
    const rawRecentPosts = bundle.recent_posts ?? [];

    // Classification fields (stats_data/round_id/group_post_id) stay server-
    // side — the wire shapes don't grow.
    const recentPosts = (rawRecentPosts || [])
      .filter(p => !isStatementPost(p) && !isTrainingPost(p))
      .slice(0, 6)
      .map(p => ({
        id: p.id,
        caption: p.caption,
        sport_key: p.sport_key,
        created_at: p.created_at,
        likes_count: p.likes_count,
        comments_count: p.comments_count,
        // What a media-less tile is (Oct 9 2026 appearance round — those
        // tiles were grey boxes with a caption). A coarse label and an icon
        // ONLY: no numbers, route, or ids leave this CDN-cached stranger read.
        tile: recentPostTile(p),
        // Anonymous page, but the bytes still route through the proxy (these
        // are public posts, so the proxy serves them to anyone).
        post_media: (p.post_media as Array<{ media_url: string }> | null || []).map(m => ({
          ...m,
          // A public profile's public posts (the only ones this reader selects): the optimizable form.
          media_url: toProxyUrl(m.media_url, { type: 'post', id: p.id }, { visibility: 'public' }) ?? m.media_url,
        })),
      }));
    const statementRows = (rawRecentPosts || [])
      .filter(p => isStatementPost(p))
      .slice(0, 6);

    // Reposts on the anonymous page: hydrate a TINY quoted excerpt, and only
    // when both the original post AND its owner's profile are public — the
    // strictest read-time gate, since there is no viewer to grant more.
    // Anything else ships shared_post: null (client renders "unavailable").
    const repostOriginalIds = [...new Set(
      statementRows.map(p => p.shared_post_id).filter((id): id is string => !!id)
    )];
    const publicOriginalById = new Map<string, { author_name: string | null; caption: string | null }>();
    if (repostOriginalIds.length > 0) {
      const originals = (bundle.repost_originals ?? []).filter(o => repostOriginalIds.includes(o.id));
      for (const orig of originals) {
        if (orig.visibility !== 'public' || orig.owner_visibility !== 'public') continue;
        const authorName = orig.owner_full_name
          || [orig.owner_first_name, orig.owner_last_name].filter(Boolean).join(' ')
          || null;
        publicOriginalById.set(orig.id, {
          author_name: authorName,
          caption: orig.caption ? String(orig.caption).slice(0, 140) : null,
        });
      }
    }

    const statements = statementRows.map(p => ({
      id: p.id,
      caption: p.caption,
      created_at: p.created_at,
      likes_count: p.likes_count,
      comments_count: p.comments_count,
      shared_post_id: p.shared_post_id ?? null,
      shared_post: p.shared_post_id
        ? publicOriginalById.get(p.shared_post_id) ?? null
        : null,
    }));

    // Fetch top achievements (real athlete_achievements rows — the fields
    // the pill treatment needs; podium ranking happens client-side)
    const achievements = bundle.achievements ?? [];

    // Skill cards — one per ACTIVE sport (not just the declared one), each
    // with provenance-tagged tracked metrics (golf: the computed handicap)
    // and self-reported credentials. Viewer-independent like everything else
    // here, so the CDN cacheability below is unaffected; the golf handicap
    // recompute is the accepted cost, amortized by s-maxage. (The legacy
    // sportStats/sportSettings fields these superseded were removed
    // Aug 2026, one release after skillCards shipped.)
    // The STRANGER's view, always: this payload is CDN-cached for everyone
    // (never `includePrivate` — the owner's private lines ride the private
    // /api/profile/[id]/skill-cards answer).
    const skillCards = await buildSportSkillCards(profile.id, supabase, {}, {
      sport: profile.sport,
      postSportKeys: bundle.post_sport_keys ?? [],
      settingsRows: bundle.sport_settings ?? [],
      activity: { golf: (bundle.golf_rounds_count ?? 0) > 0 },
      statPosts: bundle.stat_posts ?? {},
    });

    // Org memberships (org connections round) — public data by the
    // membership-is-public decision; rides the aggregate so /u/ stays
    // anonymous-cheap (the strip gets initialData, no client fetch).
    // Viewer-independent + CDN-cached: the STRANGER view (a private org never
    // rides this payload; owners are redirected off /u/ anyway).
    const organizations = await getProfileOrganizations(supabase, profile.id, STRANGER_VIEW, { membershipRows: bundle.memberships ?? [], orgs: bundle.organizations ?? [] });

    // Elective Training privacy (migration 122): the body aspect hides
    // height/weight here exactly as it does on /api/vitals — this route used
    // to leak them regardless of the setting. Viewer-independence holds
    // (isOwner=false for everyone; owners see their own data on /athlete),
    // so the CDN cacheability below is unaffected. Fields stay in the shape
    // as nulls — clients already treat them as optional.
    const trainingPrivacy = parseTrainingPrivacy(trainingPrivacyCol);
    const bodyHidden = aspectHidden(trainingPrivacy, 'body', false);

    return NextResponse.json({
      profile: {
        ...profileFields,
        ...(bodyHidden ? { height_cm: null, weight_kg: null, weight_unit: null } : {}),
        cover: coverProxyUrl(profile.id, coverUrlCol),
        followersCount: followersCountCol ?? 0,
        followingCount: followingCountCol ?? 0,
        postsCount: Math.max((postsCount || 0) - (statementsTotal || 0) - (trainingTotal || 0), 0)
      },
      recentPosts,
      statements,
      achievements,
      // Deprecated: athlete_badges no longer render anywhere. Kept one
      // release so cached clients keep working.
      badges: [],
      skillCards,
      organizations,
      // Deprecated alias — kept one release so cached clients keep working
      golfStats: null
    }, {
      // The public-profile payload is viewer-independent: private profiles are
      // 403'd above, and the only per-viewer behaviour ("this is you" CTA) is
      // decided client-side. So it is CDN-cacheable per handle with NO
      // Vary:Cookie — one cached entry serves everyone, authed or not. The
      // media URLs inside are already proxied and re-authorized separately.
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });

  } catch (error) {
    reportRouteError('Public profile API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/** The coarse kind of a recent post, for a tile with no photo. Public facts only. */
function recentPostTile(p: { stats_data: unknown; round_id: unknown; group_post_id: unknown; sport_key: string | null }): { kind: 'round' | 'activity' | 'stats' | 'text'; label: string | null; icon: string | null } {
  if (p.round_id || p.group_post_id) return { kind: 'round', label: 'Golf round', icon: 'golf-ball' };
  const sd = p.stats_data as { type?: unknown; activity_type?: unknown } | null;
  if (sd && sd.type === 'activity' && isActivityType(sd.activity_type)) {
    const def = ACTIVITY_TYPE_DEFS[sd.activity_type];
    return { kind: 'activity', label: def.label, icon: def.icon };
  }
  if (sd && typeof sd === 'object' && Object.keys(sd).length > 0) {
    const sport = p.sport_key ? SPORT_REGISTRY[p.sport_key as SportKey] : undefined;
    return { kind: 'stats', label: sport ? `${sport.display_name} stats` : 'Stats', icon: 'chart-line' };
  }
  return { kind: 'text', label: null, icon: null };
}
