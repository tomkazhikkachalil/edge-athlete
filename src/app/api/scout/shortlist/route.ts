import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { requireScout } from '@/lib/recruiting/scout-access';
import { addToShortlist, listShortlist } from '@/lib/recruiting/shortlist-server';

// ── /api/scout/shortlist (Recruiting skeleton R3) ─────────────────────────
// GET: the scout's shortlist (athlete summaries + notes). POST { athleteId }:
// add — the athlete must be recruitable NOW (claimed, public, open). Both
// requireScout (a session whose profile is a scout account). Pre-183 the
// GET answers { supported: false } and the POST a 409 naming the migration.

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  try {
    let scout: { id: string };
    try {
      scout = await requireScout(request);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
    const result = await listShortlist(getSupabaseAdmin(), scout.id);
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error('[scout/shortlist] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let scout: { id: string };
    try {
      scout = await requireScout(request);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
    const limited = await enforceRateLimit(request, 'scout-shortlist', { userId: scout.id });
    if (limited) return limited;
    const body = (await request.json().catch(() => null)) as { athleteId?: unknown } | null;
    const athleteId = typeof body?.athleteId === 'string' ? body.athleteId : '';
    if (!isUuid(athleteId)) return NextResponse.json({ error: 'Invalid athlete' }, { status: 400 });
    const outcome = await addToShortlist(getSupabaseAdmin(), scout.id, athleteId);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ ok: true, ...outcome.value }, { headers: NO_STORE });
  } catch (error) {
    console.error('[scout/shortlist] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
