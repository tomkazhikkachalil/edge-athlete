import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireCompetitionManager } from '@/lib/orgs/competition-server';
import {
  contestMediaDELETE,
  contestMediaGET,
  contestMediaPublishPATCH,
  contestMediaUploadPOST,
} from '@/lib/orgs/contest-media-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/leagues/[id]/competitions/[competitionId]/media (phase 4 R3) ───────
// The contest media library. The gate proves the caller manages THIS
// league; the lib resolves owner vs participant authority (a league is
// never a participant). Upload = multipart {file, contestId, caption?};
// PATCH {mediaId, published} is the owner-only gallery-curation bit.

async function gateAndParams(
  request: NextRequest,
  params: Promise<{ id: string; competitionId: string }>
) {
  const user = await requireAuth(request);
  const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
  if (limited) return { limited };
  const { id, competitionId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(competitionId)) {
    return { limited: NextResponse.json({ error: 'Competition not found' }, { status: 404 }) };
  }
  const admin = getSupabaseAdmin();
  const gate = await requireCompetitionManager(admin, user, 'league', id);
  if (!gate.ok) return { limited: gate.response };
  return { user, admin, id, competitionId };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const ctx = await gateAndParams(request, params);
    if ('limited' in ctx) return ctx.limited;
    const contestId = new URL(request.url).searchParams.get('contestId');
    if (!contestId || !UUID_RE.test(contestId)) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    return await contestMediaGET(ctx.admin, contestId, { side: 'league', orgId: ctx.id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONTEST MEDIA] league GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const ctx = await gateAndParams(request, params);
    if ('limited' in ctx) return ctx.limited;
    const formData = await request.formData();
    const file = formData.get('file');
    const contestId = formData.get('contestId');
    const caption = formData.get('caption');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    if (typeof contestId !== 'string' || !UUID_RE.test(contestId)) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }
    return await contestMediaUploadPOST(
      ctx.admin,
      contestId,
      file,
      typeof caption === 'string' && caption ? caption : null,
      { side: 'league', orgId: ctx.id },
      ctx.user.id
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONTEST MEDIA] league POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; competitionId: string }> }
) {
  try {
    const ctx = await gateAndParams(request, params);
    if ('limited' in ctx) return ctx.limited;
    const body = await request.json().catch(() => null);
    const mediaId = body?.mediaId;
    const published = body?.published;
    if (typeof mediaId !== 'string' || !UUID_RE.test(mediaId) || typeof published !== 'boolean') {
      return NextResponse.json({ error: 'mediaId and published are required' }, { status: 400 });
    }
    return await contestMediaPublishPATCH(ctx.admin, mediaId, published, {
      side: 'league',
      orgId: ctx.id,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONTEST MEDIA] league PATCH error:', error);
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
    const mediaId = new URL(request.url).searchParams.get('mediaId');
    if (!mediaId || !UUID_RE.test(mediaId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return await contestMediaDELETE(
      ctx.admin,
      mediaId,
      { side: 'league', orgId: ctx.id },
      ctx.user.id
    );
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CONTEST MEDIA] league DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
