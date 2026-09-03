import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-server';
import { photoConsentGET, photoConsentPATCH } from '@/lib/org-sites/member-photos-routes';

// ── /api/leagues/[id]/photo-consent — "Share my round photos with this league"
// (M2, program 10; both sides since program 12). A MEMBER's own decision on
// their own follow row — self only, never a manager, never a guardian path.
// The gate is called HERE (the route-authz audit); the logic lives in
// org-sites/member-photos-routes.

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    return await photoConsentGET(user, 'league', params);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(request);
    return await photoConsentPATCH(request, user, 'league', params);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
