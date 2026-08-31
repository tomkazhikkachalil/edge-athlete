import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { EntryAddSchema } from '@/lib/competitions/validate';
import { entryAddPOST, entryDELETE } from '@/lib/orgs/competition-server';
import { UUID_RE } from '@/lib/golf/course-catalog';

// ── /api/admin/competitions/entries — thin wrapper over competition-server ──

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const parsed = await parseBody(request, EntryAddSchema);
    if (!parsed.success) return parsed.response;
    return await entryAddPOST(getSupabaseAdmin(), parsed.data, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] entries POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id || !UUID_RE.test(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    return await entryDELETE(getSupabaseAdmin(), id, null);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[ADMIN COMPETITIONS] entries DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
