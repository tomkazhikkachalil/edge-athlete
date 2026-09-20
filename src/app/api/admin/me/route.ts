import { NextRequest, NextResponse } from 'next/server';
import { platformRoleFor, requireAuth } from '@/lib/auth-server';

/**
 * GET /api/admin/me — "is this session an admin, and which kind?" for the
 * header's menu (data foundation, F5c; roles since Support & Reporting
 * Spec 1). `admin: true` means OWNER — the pre-222 meaning, so the existing
 * dashboard gate is unchanged; `role: 'moderator'` opens the support queue
 * only. A plain member answers 403 exactly as before. Never cached: the
 * allowlist is an env var and the roles table changes without a deploy.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const role = await platformRoleFor(user);
    if (!role) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
    }
    return NextResponse.json({ admin: role === 'owner', role }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
