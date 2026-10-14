/**
 * Sport Settings API Route
 *
 * Handles CRUD operations for sport-specific athlete settings.
 * Each sport (golf, hockey, basketball, etc.) stores its settings in JSONB format.
 *
 * GET: Fetch settings for a specific sport
 * PUT: Update settings for a specific sport
 * PATCH: Pin / unpin / move a sport on the profile (263, Oct 14 2026)
 * DELETE: Remove settings for a specific sport
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { applyPinChange, MAX_PINNED_SPORTS, type PinChange } from '@/lib/sports/sport-pins';
import { readSportPins, writeSportPins } from '@/lib/sports/pins-server';
import { buildSportSkillCards } from '@/lib/sports/server';

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
        reportRouteError('Error listing sport settings:', listError);
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
      reportRouteError('Error fetching sport settings:', error);
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
    reportRouteError('Sport settings GET error:', error);
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
      reportRouteError('Error upserting sport settings:', error);
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
    reportRouteError('Sport settings PUT error:', error);
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
      reportRouteError('Error deleting sport settings:', error);
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
    reportRouteError('Sport settings DELETE error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/sport-settings — pin, unpin or move a sport on the caller's
 * OWN profile (profile quick fixes PR 3, Oct 14 2026; migration 263).
 * Body: { sport: SportKey, pinned: boolean, position?: number } — `position`
 * (1-based) pins AT a slot or moves a pinned sport; omitted, a pin appends.
 * NOT on THE write-gate list on purpose: a pin is the presentation of one's
 * own profile (like the training-privacy setting), never content or contact. Owner only —
 * the user client's RLS. The ONE pin rule is sport-pins.ts applyPinChange
 * (the whole packed list, every time); the ONE writer pins-server.ts.
 * Answers { pins, skillCards } (the owner's view, no second fetch); 400 for
 * an unknown sport or a bad body; 409 { code: 'pin_cap', max } at the cap.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { supabase, user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    let body: { sport?: unknown; pinned?: unknown; position?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const sport = typeof body.sport === 'string' ? (body.sport as SportKey) : null;
    if (!sport || !SPORT_REGISTRY[sport]) {
      return NextResponse.json({ error: 'sport must be a registered sport key' }, { status: 400 });
    }
    if (typeof body.pinned !== 'boolean') {
      return NextResponse.json({ error: 'pinned must be a boolean' }, { status: 400 });
    }
    const position = body.position === undefined ? undefined : Number(body.position);
    if (position !== undefined && (!Number.isInteger(position) || position < 1)) {
      return NextResponse.json({ error: 'position must be a positive integer' }, { status: 400 });
    }

    const current = await readSportPins(supabase, user.id);
    const change: PinChange = !body.pinned
      ? { kind: 'unpin', key: sport }
      : current.includes(sport) && position !== undefined
        ? { kind: 'move', key: sport, position }
        : { kind: 'pin', key: sport, position };
    const result = applyPinChange(current, change);
    if (result.refused === 'pin_cap') {
      return NextResponse.json({ error: `You can pin up to ${MAX_PINNED_SPORTS} sports.`, code: 'pin_cap', max: MAX_PINNED_SPORTS }, { status: 409 });
    }
    await writeSportPins(supabase, user.id, result.pins);

    const skillCards = await buildSportSkillCards(user.id, supabase, { includePrivate: true });
    return NextResponse.json({ pins: result.pins, skillCards }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    reportRouteError('Sport settings PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
