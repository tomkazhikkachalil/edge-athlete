import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { runStorageSweep } from '@/lib/storage-sweep-server';

// Full-bucket walk + full-table reference scan can exceed the default limit.
export const maxDuration = 60;

/**
 * POST /api/admin/storage-sweep — find (and optionally delete) uploads-bucket
 * files no DB row references anymore. Admin-only. Body: { dryRun?: boolean }.
 * DRY RUN BY DEFAULT — deletion requires an explicit { "dryRun": false }.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();

    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun !== false;

    const summary = await runStorageSweep(supabase, dryRun);
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[SWEEP] error:', error);
    return NextResponse.json({ error: 'Storage sweep failed' }, { status: 500 });
  }
}
