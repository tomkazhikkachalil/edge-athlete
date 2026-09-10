import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireScout } from '@/lib/recruiting/scout-access';
import { readShortlistEntry, removeFromShortlist, updateShortlistNote } from '@/lib/recruiting/shortlist-server';

// ── /api/scout/shortlist/[athleteId] (Recruiting skeleton R3) ─────────────
// GET: is this athlete on MY shortlist (+ my note) — the button's state.
// PATCH { note }: the private note. DELETE: remove. All requireScout.

const NO_STORE = { 'Cache-Control': 'private, no-store' };

async function gate(request: NextRequest, athleteId: string): Promise<{ id: string } | NextResponse | Response> {
  if (!isUuid(athleteId)) return NextResponse.json({ error: 'Invalid athlete' }, { status: 400 });
  try {
    return await requireScout(request);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ athleteId: string }> }) {
  try {
    const { athleteId } = await params;
    const scout = await gate(request, athleteId);
    if (scout instanceof Response) return scout;
    return NextResponse.json(await readShortlistEntry(getSupabaseAdmin(), scout.id, athleteId), { headers: NO_STORE });
  } catch (error) {
    console.error('[scout/shortlist/id] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ athleteId: string }> }) {
  try {
    const { athleteId } = await params;
    const scout = await gate(request, athleteId);
    if (scout instanceof Response) return scout;
    const limited = await enforceRateLimit(request, 'scout-shortlist', { userId: scout.id });
    if (limited) return limited;
    const body = (await request.json().catch(() => null)) as { note?: unknown } | null;
    const outcome = await updateShortlistNote(getSupabaseAdmin(), scout.id, athleteId, body?.note);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ ok: true, ...outcome.value }, { headers: NO_STORE });
  } catch (error) {
    console.error('[scout/shortlist/id] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ athleteId: string }> }) {
  try {
    const { athleteId } = await params;
    const scout = await gate(request, athleteId);
    if (scout instanceof Response) return scout;
    const limited = await enforceRateLimit(request, 'scout-shortlist', { userId: scout.id });
    if (limited) return limited;
    const outcome = await removeFromShortlist(getSupabaseAdmin(), scout.id, athleteId);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    console.error('[scout/shortlist/id] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
