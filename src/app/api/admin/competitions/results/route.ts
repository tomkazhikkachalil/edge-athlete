import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { ResultUpsertSchema } from '@/lib/competitions/validate';
import { resultsUpsertPOST } from '@/lib/orgs/competition-server';

// ── /api/admin/competitions/results — thin wrapper, scope null ──────────────

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request);
    const parsed = await parseBody(request, ResultUpsertSchema);
    if (!parsed.success) return parsed.response;
    return await resultsUpsertPOST(getSupabaseAdmin(), parsed.data, null, user.id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] results POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
