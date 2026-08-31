import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { recomputeStandings } from '@/lib/competitions/standings';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/competitions/recompute?id= — the standings repair lever ──────
// The hook sites are best-effort by design; this heals any drift on
// demand (and is the probe's idempotency check: run twice, same rows).

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const rows = await recomputeStandings(getSupabaseAdmin(), id);
    if (rows === null) {
      return NextResponse.json({ error: 'Recompute failed or not applicable' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, rows });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] recompute error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
