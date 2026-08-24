import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { ClubRequestSchema, placeToClubColumns, isMissingTableError } from '@/lib/clubs/validate';

// ── /api/clubs/requests — self-service "Start a club" (117) ─────────────────
// Mirror of /api/leagues/requests, minus sport (clubs are multi-sport by
// decision). The requester is ALWAYS the session user; one pending request
// per user via the partial unique index (23505 → 409).

/** POST — submit a request. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'club-request', { userId: user.id });
    if (limited) return limited;

    const parsed = await parseBody(request, ClubRequestSchema);
    if (!parsed.success) return parsed.response;
    const { name, description, place } = parsed.data;

    const supabase = getSupabaseAdmin();
    const { data: row, error } = await supabase
      .from('club_requests')
      .insert({
        requester_profile_id: user.id,
        name,
        description: description ?? null,
        ...placeToClubColumns(place),
      })
      .select()
      .single();
    if (error || !row) {
      if (error?.code === '23505') {
        return NextResponse.json(
          { error: 'You already have a club request waiting for review' },
          { status: 409 }
        );
      }
      if (isMissingTableError(error?.code)) {
        return NextResponse.json({ error: 'Club requests are not available yet' }, { status: 503 });
      }
      console.error('[CLUB REQUESTS] insert error:', error);
      return NextResponse.json({ error: 'Failed to submit request' }, { status: 500 });
    }

    return NextResponse.json({ request: row });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB REQUESTS] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** GET — the caller's own requests, newest first. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('club_requests')
      .select('id, name, description, city, region, country, status, decline_reason, decided_at, created_club_id, created_at')
      .eq('requester_profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      if (isMissingTableError(error.code)) return NextResponse.json({ requests: [] });
      console.error('[CLUB REQUESTS] list error:', error);
      return NextResponse.json({ error: 'Failed to load requests' }, { status: 500 });
    }
    return NextResponse.json({ requests: data ?? [] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB REQUESTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
