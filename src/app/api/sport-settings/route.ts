/**
 * Sport Settings API Route
 *
 * Handles CRUD operations for sport-specific athlete settings.
 * Each sport (golf, hockey, basketball, etc.) stores its settings in JSONB format.
 *
 * GET: Fetch settings for a specific sport
 * PUT: Update settings for a specific sport
 * DELETE: Remove settings for a specific sport
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Helper function for cookie-based authentication (Next.js 15 pattern)
function createSupabaseClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          const cookieHeader = request.headers.get('cookie');
          if (!cookieHeader) return undefined;
          const cookies = Object.fromEntries(
            cookieHeader.split('; ').map(cookie => {
              const [key, value] = cookie.split('=');
              return [key, decodeURIComponent(value)];
            })
          );
          return cookies[name];
        },
      },
    }
  );
}

/**
 * GET /api/sport-settings?sport=golf
 *
 * Fetch sport settings for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = createSupabaseClient(request);

    // Verify authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get sport key from query params
    const sportKey = request.nextUrl.searchParams.get('sport');
    if (!sportKey) {
      return NextResponse.json(
        { error: 'sport parameter is required' },
        { status: 400 }
      );
    }

    // Fetch sport settings (RLS automatically enforces user can only see their own)
    const { data, error } = await supabase
      .from('sport_settings')
      .select('*')
      .eq('profile_id', user.id)
      .eq('sport_key', sportKey)
      .maybeSingle(); // Returns null if not found (not an error)

    if (error) {
      console.error('Error fetching sport settings:', error);
      return NextResponse.json(
        { error: 'Failed to fetch sport settings' },
        { status: 500 }
      );
    }

    // Return settings (or empty object if no settings exist yet)
    return NextResponse.json({
      sportKey,
      settings: data?.settings || {},
      exists: !!data
    });

  } catch (error) {
    console.error('Sport settings GET error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/sport-settings
 *
 * Update sport settings for the authenticated user
 * Body: { sport: 'golf', settings: { handicap: 12, ... } }
 */
export async function PUT(request: NextRequest) {
  try {
    const supabase = createSupabaseClient(request);

    // Verify authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { sport, settings } = body;

    // Validate input
    if (!sport || typeof sport !== 'string') {
      return NextResponse.json(
        { error: 'sport is required and must be a string' },
        { status: 400 }
      );
    }

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json(
        { error: 'settings is required and must be an object' },
        { status: 400 }
      );
    }

    // Upsert sport settings (insert if doesn't exist, update if exists)
    const { data, error } = await supabase
      .from('sport_settings')
      .upsert(
        {
          profile_id: user.id,
          sport_key: sport,
          settings: settings,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'profile_id,sport_key' // Unique constraint
        }
      )
      .select()
      .single();

    if (error) {
      console.error('Error upserting sport settings:', error);
      return NextResponse.json(
        { error: 'Failed to save sport settings' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Sport settings PUT error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sport-settings?sport=golf
 *
 * Delete sport settings for the authenticated user
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createSupabaseClient(request);

    // Verify authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get sport key from query params
    const sportKey = request.nextUrl.searchParams.get('sport');
    if (!sportKey) {
      return NextResponse.json(
        { error: 'sport parameter is required' },
        { status: 400 }
      );
    }

    // Delete sport settings (RLS automatically enforces user can only delete their own)
    const { error } = await supabase
      .from('sport_settings')
      .delete()
      .eq('profile_id', user.id)
      .eq('sport_key', sportKey);

    if (error) {
      console.error('Error deleting sport settings:', error);
      return NextResponse.json(
        { error: 'Failed to delete sport settings' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${sportKey} settings deleted successfully`
    });

  } catch (error) {
    console.error('Sport settings DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
