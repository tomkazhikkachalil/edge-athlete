import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

/**
 * GET /api/admin/golf-course-picks — which picked courses have a card (294):
 * pick totals by card kind, and the most-picked courses with no provider card.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = getSupabaseAdmin();
    const { data: all, error } = await admin.from('golf_course_picks').select('card, picks').limit(1000);
    if (error) throw new Error(error.message);
    const totals: Record<string, { courses: number; picks: number }> = {
      provider: { courses: 0, picks: 0 }, map: { courses: 0, picks: 0 }, none: { courses: 0, picks: 0 },
    };
    for (const r of all ?? []) {
      const t = totals[r.card as string];
      if (t) { t.courses += 1; t.picks += r.picks as number; }
    }
    const { data: top, error: topError } = await admin
      .from('golf_course_picks')
      .select('card, picks, last_picked_at, golf_courses(name, city, region)')
      .in('card', ['none', 'map'])
      .order('picks', { ascending: false })
      .limit(50);
    if (topError) throw new Error(topError.message);
    return NextResponse.json({ totals, top: top ?? [] }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[golf-course-picks]', error);
    return NextResponse.json({ error: 'Could not read course picks' }, { status: 500, headers: NO_STORE });
  }
}
