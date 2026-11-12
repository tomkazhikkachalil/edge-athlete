import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { parseGameBody } from '@/lib/videos/game-rules';
import { deleteGame, readGame, saveGame } from '@/lib/videos/video-games-server';
import { readVideoForViewer } from '@/lib/videos/videos-server';
import { reportRouteError } from '@/lib/observability/report';

const PRIVATE = { 'Cache-Control': 'private, no-store' };
const NOT_FOUND = () => NextResponse.json({ error: 'Video not found' }, { status: 404, headers: PRIVATE });

/**
 * The game on a linked video (Sprint 3 PR 2, migration 307): its sport, the
 * two sides, the day, whether every scoring play is tagged, and the
 * spoiler-free default. The rights are the VIDEO's: whoever may see the
 * video reads it; a manager of the video writes it.
 *
 * GET → {game | null}. PUT {sport_key, played_on?, side1?, side2?,
 * coverage?, stats_hidden?} → {game} (the whole game every time). DELETE →
 * the video is a plain video again; its highlights stay.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user ?? null);
    if (!read) return NOT_FOUND();
    return NextResponse.json({ game: await readGame(admin, id), can_manage: read.canManage }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/game] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const body = await request.json().catch(() => null);
    const parsed = parseGameBody(body, new Date().toISOString().slice(0, 10));
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can edit this video.' }, { status: 403 });
    const saved = await saveGame(admin, id, parsed.value, user.id);
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
    return NextResponse.json({ game: saved.value }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/game] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NOT_FOUND();
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NOT_FOUND();
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can edit this video.' }, { status: 403 });
    const gone = await deleteGame(admin, id);
    if (!gone.ok) return NextResponse.json({ error: gone.error }, { status: gone.status });
    return NextResponse.json({ ok: true }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/game] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
