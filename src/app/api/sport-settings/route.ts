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
import { getServerAuth } from '@/lib/auth-server';

/**
 * GET /api/sport-settings?sport=golf
 *
 * Fetch sport settings for the authenticated user
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const { supabase, user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Get sport key from query params. WITHOUT one, list every sport the
    // user has a settings row for (additive — used by Edit Profile's sport
    // multi-select to show intake-declared sports).
    const sportKey = request.nextUrl.searchParams.get('sport');
    if (!sportKey) {
      const { data: rows, error: listError } = await supabase
        .from('sport_settings')
        .select('sport_key, settings')
        .eq('profile_id', user.id);

      if (listError) {
        console.error('Error listing sport settings:', listError);
        return NextResponse.json(
          { error: 'Failed to fetch sport settings' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        sports: (rows || []).map(r => ({ sportKey: r.sport_key, settings: r.settings || {} })),
      });
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
    // Verify authentication
    const { supabase, user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
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
    // Verify authentication
    const { supabase, user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
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
