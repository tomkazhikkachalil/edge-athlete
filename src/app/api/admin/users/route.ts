import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';

// Sanitize input for a PostgREST .or()/.ilike() filter: STRIP structural
// delimiters (comma, parens, double-quote) so a value can't break out and
// inject or-terms, then escape LIKE wildcards. Backslash-escaping delimiters
// is not PostgREST's documented mechanism; stripping is unconditionally safe.
// Same approach as course-catalog.ts `likeSafe`.
function sanitizeForFilter(input: string): string {
  return input.replace(/[,()"]/g, ' ').replace(/[%_\\]/g, m => `\\${m}`).trim();
}

// ── GET /api/admin/users?q= ───────────────────────────────────────────────────
// Basic user lookup for support/moderation. Admin-only (ADMIN_EMAILS).
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || '';

    // Suggest from the first keystroke like every other search in the app.
    // Deliberately NOT folded onto searchPeople: this one also matches email
    // and intentionally ignores visibility, and adding an "unfiltered" mode to
    // a function whose whole job is the privacy filter is how the 085/086 bugs
    // happened. It stays a plain substring scan — it is requireAdmin-gated and
    // low-traffic, so it does not need 087's index path.
    if (q.length < 1) {
      return NextResponse.json({ users: [] });
    }

    const pattern = `%${sanitizeForFilter(q)}%`;
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, email, first_name, last_name, full_name, handle, user_type, visibility, created_at, onboarded_at')
      .or(`email.ilike.${pattern},full_name.ilike.${pattern},first_name.ilike.${pattern},last_name.ilike.${pattern},handle.ilike.${pattern}`)  // hardening-ok: sanitizeForFilter above
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('GET /api/admin/users error:', error);
      return NextResponse.json({ error: 'Failed to search users' }, { status: 500 });
    }

    return NextResponse.json({ users: users || [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/admin/users error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
