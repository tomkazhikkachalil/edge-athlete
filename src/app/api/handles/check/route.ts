import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);
    const handle = searchParams.get('handle');
    // Prefer the session user over the spoofable query param (only affects
    // "it's already yours" availability answers, but be correct anyway)
    let currentUserId = searchParams.get('currentUserId');
    try {
      const user = await requireAuth(request);
      currentUserId = user.id;
    } catch {
      // anonymous (e.g. signup flow) — fall back to the param
    }

    if (!handle) {
      return NextResponse.json(
        { error: 'Handle is required' },
        { status: 400 }
      );
    }

    // IP-keyed on purpose: this route is deliberately anon-friendly (signup
    // flow), and it's an enumeration surface.
    const limited = await enforceRateLimit(request, 'handle-check');
    if (limited) return limited;

    // Call the database function to check availability
    const { data, error } = await supabase
      .rpc('check_handle_availability', {
        input_handle: handle,
        current_profile_id: currentUserId || null
      });

    if (error) {
      console.error('Error checking handle availability:', error);
      return NextResponse.json(
        { error: 'Failed to check handle availability' },
        { status: 500 }
      );
    }

    // Return the first row (function returns a table)
    const result = data && data.length > 0 ? data[0] : null;

    if (!result) {
      return NextResponse.json(
        {
          available: false,
          reason: 'Unable to verify handle availability'
        }
      );
    }

    return NextResponse.json({
      available: result.available,
      reason: result.reason,
      suggestions: result.suggestions || []
    });
  } catch (error) {
    console.error('Error in GET /api/handles/check:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
