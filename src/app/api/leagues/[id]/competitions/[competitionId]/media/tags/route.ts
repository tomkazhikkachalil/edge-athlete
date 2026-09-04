import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import { contestMediaTagDELETE, contestMediaTagPOST } from '@/lib/orgs/contest-media-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/[competitionId]/media/tags (phase 4 R3) ──
// Roster-scoped attribution on contest media: POST {mediaId, profileIds}
// tags athletes from the participating teams' rosters (tombstones never
// resurrected; guardians belled); DELETE ?mediaId=&profileId= untags
// (tombstone). Athlete/guardian self-untag lives on the profile route.

async function gateAndParams(
  request: NextRequest,
  params: Promise<{ id: string; competitionId: string }>
) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'org-competitions', { userId: user.id });
  if (limited) return { limited };
  const { id, competitionId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
    return { limited: NextResponse.json({ error: 'Competition not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const gate = await requireCompetitionManager(admin, user, 'league', id, { competitionId });
  if (!gate.ok) return { limited: gate.response };
  return { user, admin, id, competitionId };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const ctx = await gateAndParams(request, params);
    if ('limited' in ctx) return ctx.limited;
    const body = await request.json().catch(() => null);
    const mediaId = body?.mediaId;
    const profileIds = body?.profileIds;
    if (
      typeof mediaId !== 'string' ||
      !UUID_RE.test(mediaId) ||
      !Array.isArray(profileIds) ||
      profileIds.length === 0 ||
      profileIds.length > 50 ||
      !profileIds.every(p => typeof p === 'string' && UUID_RE.test(p))
    ) {
      return NextResponse.json({ error: 'mediaId and profileIds are required' }, { status: 400 });
    }
    return await contestMediaTagPOST(
      ctx.admin,
      mediaId,
      profileIds,
      { side: 'league', orgId: ctx.id },
      ctx.user.id
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONTEST MEDIA] league tags POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const ctx = await gateAndParams(request, params);
    if ('limited' in ctx) return ctx.limited;
    const url = new URL(request.url);
    const mediaId = url.searchParams.get('mediaId');
    const profileId = url.searchParams.get('profileId');
    if (!mediaId || !UUID_RE.test(mediaId) || !profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return await contestMediaTagDELETE(ctx.admin, mediaId, profileId, {
      side: 'league',
      orgId: ctx.id,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONTEST MEDIA] league tags DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
