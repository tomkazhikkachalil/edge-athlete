import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAuth } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';

// Fields safe to return to a viewer who is NOT the profile owner.
// Contact details (email, phone) are owner-only.
const CONTACT_FIELDS = ['email', 'phone'] as const;

// Minimal subset for blocked viewers — exactly what PrivateProfileView needs.
const MINIMAL_FIELDS = [
  'id', 'full_name', 'first_name', 'middle_name', 'last_name',
  'avatar_url', 'handle', 'sport', 'school', 'visibility', 'user_type',
] as const;

// user_type values a user may set on their own account. Organization types
// (club, league) will be provisioned through a separate flow.
const SELF_SERVICE_USER_TYPES = ['athlete', 'fan'] as const;

export async function GET(request: NextRequest) {
  try {
    // Auth required — this endpoint returns non-public profile fields.
    // (Anonymous surfaces use /api/public/profile instead.)
    const user = await requireAuth(request);

    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('id');
    
    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID is required' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ 
        error: 'Server configuration error - supabaseAdmin not available' 
      }, { status: 500 });
    }

    // Fetch profile data
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .single();

    if (profileError) {
      console.error('Profile error:', profileError);
      if (profileError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      }
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }

    // Fetch badges
    const { data: badges, error: badgesError } = await supabaseAdmin
      .from('athlete_badges')
      .select('*')
      .eq('athlete_id', profileId)
      .order('created_at', { ascending: false });

    if (badgesError && badgesError.code !== 'PGRST116') {
      console.error('Badges error:', badgesError);
    }

    // Fetch season highlights
    const { data: seasonHighlights, error: highlightsError } = await supabaseAdmin
      .from('season_highlights')
      .select('*')
      .eq('athlete_id', profileId)
      .order('season', { ascending: false });

    if (highlightsError && highlightsError.code !== 'PGRST116') {
      console.error('Season highlights error:', highlightsError);
    }

    // Fetch performances
    const { data: performances, error: performancesError } = await supabaseAdmin
      .from('performances')
      .select('*')
      .eq('athlete_id', profileId)
      .order('date', { ascending: false });

    if (performancesError && performancesError.code !== 'PGRST116') {
      console.error('Performances error:', performancesError);
    }

    // Privacy-shape the profile server-side (the browser must never receive
    // fields the viewer isn't entitled to).
    const isOwner = user.id === profileId;
    let shapedProfile: Record<string, unknown> = profile;

    if (!isOwner) {
      const { canView } = await canViewProfile(profileId, user.id);
      if (canView) {
        shapedProfile = { ...profile };
        for (const f of CONTACT_FIELDS) delete shapedProfile[f];
      } else {
        // Blocked (private profile, not an approved fan): minimal card only
        shapedProfile = {};
        for (const f of MINIMAL_FIELDS) shapedProfile[f] = profile[f] ?? null;
        return NextResponse.json({
          profile: shapedProfile,
          badges: [],
          seasonHighlights: [],
          performances: []
        });
      }
    }

    return NextResponse.json({
      profile: shapedProfile,
      badges: badges || [],
      seasonHighlights: seasonHighlights || [],
      performances: performances || []
    });

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Auth required — only the owner may update their profile.
    const user = await requireAuth(request);

    const body = await request.json();
    
    // Validate required fields
    if (!body.profileData) {
      console.error('Profile API: Missing required fields');
      return NextResponse.json({ error: 'Profile data is required' }, { status: 400 });
    }

    const { profileData } = body;
    const userId = user.id;

    // Reject spoofed userId (legacy clients send it; it must match the session)
    if (body.userId && body.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Never mass-assign identity/system fields
    delete profileData.id;
    delete profileData.email;
    delete profileData.created_at;
    delete profileData.updated_at;

    // user_type: self-service values only (org types provisioned separately)
    if (profileData.user_type !== undefined &&
        !SELF_SERVICE_USER_TYPES.includes(profileData.user_type)) {
      return NextResponse.json({ error: 'Invalid account type' }, { status: 400 });
    }
    
    // Clean up profileData - convert empty strings to null for optional fields
    const cleanedProfileData = { ...profileData };
    
    // Convert empty strings to null for date fields
    if (cleanedProfileData.dob === '') {
      cleanedProfileData.dob = null;
    }
    
    // Convert empty strings to null for numeric fields and log weight values
    if (cleanedProfileData.height_cm === '') {
      cleanedProfileData.height_cm = null;
    }
    if (cleanedProfileData.weight_kg === '') {
      cleanedProfileData.weight_kg = null;
    } else if (cleanedProfileData.weight_kg !== undefined) {
    }
    if (cleanedProfileData.class_year === '') {
      cleanedProfileData.class_year = null;
    }
    
    // Convert empty strings to null for optional text fields (keeps them as empty strings if that's intended)
    const optionalFields = ['username', 'bio', 'location', 'social_twitter', 'social_instagram', 'social_facebook'];
    optionalFields.forEach(field => {
      if (cleanedProfileData[field] === '') {
        cleanedProfileData[field] = null;
      }
    });
    
    // Don't null out weight_unit - keep it as is
    if (cleanedProfileData.weight_unit !== undefined) {
    }
    
    
    if (!supabaseAdmin) {
      console.error('Profile API: supabaseAdmin not configured - missing SUPABASE_SERVICE_ROLE_KEY');
      console.error('Profile API: Available env vars:', {
        url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY
      });
      return NextResponse.json({ 
        error: 'Server configuration error - supabaseAdmin not available. Missing SUPABASE_SERVICE_ROLE_KEY environment variable.' 
      }, { status: 500 });
    }
    
    // Update profile in database using admin client
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(cleanedProfileData)
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('Profile API: Database error:', error);
      console.error('Profile API: Error details:', JSON.stringify(error, null, 2));
      return NextResponse.json({ 
        error: `Database error: ${error.message || 'Failed to update profile'}`,
        details: error
      }, { status: 500 });
    }

    const response = {
      success: true,
      profile: data,
      message: 'Profile updated successfully'
    };
    return NextResponse.json(response);

  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Profile API: Unexpected error:', error);
    console.error('Profile API: Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      details: error instanceof Error ? error.stack : error
    }, { status: 500 });
  }
}