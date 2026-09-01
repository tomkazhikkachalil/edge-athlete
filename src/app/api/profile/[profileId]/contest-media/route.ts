import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin, getServerAuth, getProfileRole } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { isMissingTableError } from '@/lib/competitions/validate';
import { contestMediaProxyPath } from '@/lib/orgs/contest-media-server';

// ── /api/profile/[profileId]/contest-media (phase 4 R3) ─────────────────────
// The athlete side of contest media: everything this profile is ACTIVELY
// tagged in, org-uploaded, filling the media surface automatically. The
// profile-visibility gate mirrors the media route; bytes ride the signed
// proxy (re-authorized per request). A PRIVATE competition's items still
// show — they are the athlete's record — but its NAME is withheld from
// everyone (rendered as generic team media) until the org flips it
// public. DELETE = self/guardian untag → the tombstone (never re-added).
// Degrades to empty pre-158.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const admin = getSupabaseAdmin();
    const { user } = await getServerAuth(request);
    const viewerId = user?.id ?? null;
    const { profileId } = await params;
    if (!isUuid(profileId)) {
      return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    }

    // The media route's gate, verbatim: public profiles are open (incl.
    // anonymous); private ones require canViewProfile.
    if (viewerId !== profileId) {
      const { data: prof } = await admin
        .from('profiles')
        .select('visibility')
        .eq('id', profileId)
        .single();
      if (!prof) return NextResponse.json({ items: [] });
      if (prof.visibility !== 'public') {
        const { canView } = await canViewProfile(profileId, viewerId);
        if (!canView) return NextResponse.json({ items: [] });
      }
    }

    const { data: tagRows, error } = await admin
      .from('contest_media_tags')
      .select('media_id, created_at')
      .eq('profile_id', profileId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      if (isMissingTableError(error.code)) return NextResponse.json({ items: [] });
      console.error('[CONTEST MEDIA] profile list error:', error);
      return NextResponse.json({ error: 'Failed to load media' }, { status: 500 });
    }
    const mediaIds = (tagRows ?? []).map(t => t.media_id as string);
    if (mediaIds.length === 0) return NextResponse.json({ items: [] });

    const { data: mediaRows } = await admin
      .from('contest_media')
      .select('id, contest_id, storage_path, media_type, caption, created_at')
      .in('id', mediaIds);
    const contestIds = [...new Set((mediaRows ?? []).map(m => m.contest_id as string))];
    const { data: contests } = contestIds.length
      ? await admin
          .from('contests')
          .select('id, scheduled_at, competition_id')
          .in('id', contestIds)
      : { data: [] };
    const contestById = new Map(
      (contests ?? []).map(c => [
        c.id as string,
        { scheduledAt: (c.scheduled_at as string | null) ?? null, competitionId: c.competition_id as string },
      ])
    );
    const compIds = [...new Set([...contestById.values()].map(c => c.competitionId))];
    const { data: comps } = compIds.length
      ? await admin
          .from('competitions')
          .select('id, name, visibility')
          .in('id', compIds)
      : { data: [] };
    const compNames = new Map(
      (comps ?? [])
        .filter(c => c.visibility === 'public')
        .map(c => [c.id as string, c.name as string])
    );

    const canUntag =
      !!viewerId &&
      (viewerId === profileId || (await getProfileRole(viewerId, profileId)) === 'guardian');

    const byId = new Map((mediaRows ?? []).map(m => [m.id as string, m]));
    const items = mediaIds
      .map(id => byId.get(id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map(m => {
        const contest = contestById.get(m.contest_id as string);
        return {
          id: m.id,
          mediaType: m.media_type,
          caption: m.caption,
          url: contestMediaProxyPath(m.storage_path as string, m.id as string),
          date: contest?.scheduledAt ?? m.created_at,
          // Private competitions stay unnamed on every viewer's screen.
          competitionName: contest ? (compNames.get(contest.competitionId) ?? null) : null,
          canUntag,
        };
      });
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONTEST MEDIA] profile GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const admin = getSupabaseAdmin();
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const { profileId } = await params;
    if (!isUuid(profileId)) {
      return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    }
    const mediaId = new URL(request.url).searchParams.get('mediaId');
    if (!mediaId || !isUuid(mediaId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Self, or a guardian of the tagged profile — the post-untag rule.
    if (user.id !== profileId && (await getProfileRole(user.id, profileId)) !== 'guardian') {
      return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const { error } = await admin
      .from('contest_media_tags')
      .update({ status: 'removed' })
      .eq('media_id', mediaId)
      .eq('profile_id', profileId);
    if (error) {
      if (isMissingTableError(error.code)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      console.error('[CONTEST MEDIA] profile untag error:', error);
      return NextResponse.json({ error: 'Failed to untag' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONTEST MEDIA] profile DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
