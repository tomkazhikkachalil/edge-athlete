import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { parsePins } from '@/lib/training/pins';
import { resolvePins, writePins } from '@/lib/training/pins-server';

/**
 * PUT /api/training/pins { pins: [...] } — the signed-in athlete's OWN pinned
 * bests, the whole list in order (Training redesign PR 7, Nov 11 2026): up to
 * six, each an exercise's best of one kind or a test's best, none twice
 * (pins.ts parsePins — anything else is 400 and nothing is written). The
 * profile is never taken from the request: it is the session's. `requireAuth`
 * spends the write-general bucket. Answers the saved list as the athlete sees
 * it: { pins: [resolved…], mine: [raw…] }. `private, no-store`.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const body = (await request.json().catch(() => null)) as { pins?: unknown } | null;
    const pins = parsePins(body?.pins);
    if (!pins) return NextResponse.json({ error: 'Pins must be a list of up to six exercise or test bests, each once.' }, { status: 400, headers: NO_STORE });
    const admin = getSupabaseAdmin();
    if (!(await writePins(admin, user.id, pins))) return NextResponse.json({ error: 'Could not save your pins.' }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ pins: await resolvePins(admin, user.id, pins, { visitor: false }), mine: pins }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[training/pins] PUT error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
