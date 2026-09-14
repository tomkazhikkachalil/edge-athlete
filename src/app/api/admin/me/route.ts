import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';

/**
 * GET /api/admin/me — "is this session an admin?" for the header's menu
 * (data foundation, F5c). requireAdmin answers 401 / 403 itself; a 200
 * carries nothing but the fact. Never cached: the allowlist is an env var.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json({ admin: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
