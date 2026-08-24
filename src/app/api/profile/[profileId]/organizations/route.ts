import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { getProfileOrganizations } from '@/lib/affiliations/server';
import { UUID_RE } from '@/lib/golf/course-catalog';

/**
 * GET /api/profile/[profileId]/organizations
 *
 * The leagues and clubs a profile belongs to, with their role — the
 * profile-first read the org tables never had. Public/anonymous by the
 * existing membership-is-public decision: org pages already list member
 * names and avatars, so this exposes no new information class. The strip
 * that consumes it only mounts inside pages that already gate content.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const { profileId } = await params;
    if (!profileId || !UUID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const organizations = await getProfileOrganizations(supabase, profileId);
    return NextResponse.json({ organizations });
  } catch (e) {
    console.error('[organizations] error:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
