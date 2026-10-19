import { NextRequest, NextResponse } from 'next/server';
import { platformRoleFor } from '@/lib/auth-server';
import { readAdminSession } from '@/lib/admin/session-server';

/**
 * GET /api/admin/me — "is this session an admin, and which kind?" for the
 * header's menu (data foundation, F5c; roles since Support & Reporting
 * Spec 1). `admin: true` means OWNER — the pre-222 meaning, so the existing
 * dashboard gate is unchanged; `role: 'moderator'` opens the support queue
 * only. A plain member answers 403 exactly as before. Never cached: the
 * allowlist is an env var and the roles table changes without a deploy.
 */
export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    // The console's own cookie is the ONLY answer since B3 (Oct 19 2026): no
    // cookie → 401 (the app session never grants admin), a cookie whose role
    // is gone → 403. The header's menu shows its admin entries only to a
    // browser that also holds the console cookie.
    const claims = await readAdminSession(request);
    if (!claims) return NextResponse.json({ error: 'Admin sign-in required' }, { status: 401, headers });
    const role = await platformRoleFor({ id: claims.sub, email: claims.email });
    if (!role) return NextResponse.json({ error: 'Admin access required' }, { status: 403, headers });
    return NextResponse.json({ admin: role === 'owner', role, door: 'console' }, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
