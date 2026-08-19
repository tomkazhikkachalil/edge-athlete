import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';

// ── GET /api/profile/guardians ────────────────────────────────────────────────
// The custody link, legible from the ATHLETE's end: who manages this profile.
// Admin client on purpose — a supervised child holds no access row on their
// guardian's profile, so a browser RLS join returns NULL whenever the
// guardian is private. Returns only the session user's own guardians.

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ guardians: [] });
    }
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('profile_access')
      .select('role, granted_at, profiles!profile_access_user_id_fkey(id, first_name, last_name, display_name, avatar_url)')
      .eq('profile_id', user.id)
      .eq('role', 'guardian')
      .order('granted_at', { ascending: true });
    if (error) throw error;
    return NextResponse.json({
      guardians: (data ?? []).map(r => {
        const p = r.profiles as unknown as {
          id: string; first_name: string | null; last_name: string | null;
          display_name: string | null; avatar_url: string | null;
        };
        return {
          id: p?.id,
          first_name: p?.first_name ?? null,
          last_name: p?.last_name ?? null,
          display_name: p?.display_name ?? null,
          avatar_url: p?.avatar_url ?? null,
          role: r.role,
          since: r.granted_at,
        };
      }).filter(g => g.id),
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIANS] list error:', error);
    return NextResponse.json({ error: 'Could not load guardians' }, { status: 500 });
  }
}
