import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function PUT(request: NextRequest) {
  try {
    console.log('\n=== PROFILE API DEBUG START ===');
    console.log('Profile API: Received PUT request');
    console.log('Profile API: Request method:', request.method);
    console.log('Profile API: Request URL:', request.url);
    console.log('Profile API: Request headers:', Object.fromEntries(request.headers.entries()));
    
    const body = await request.json();
    console.log('Profile API: Request body received:', JSON.stringify(body, null, 2));
    
    // Validate required fields
    if (!body.profileData || !body.userId) {
      console.error('Profile API: Missing required fields');
      return NextResponse.json({ error: 'Profile data and user ID are required' }, { status: 400 });
    }

    const { profileData, userId } = body;
    console.log('Profile API: Updating user:', userId);
    console.log('Profile API: Update data:', JSON.stringify(profileData, null, 2));
    
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
      console.log('Profile API: Weight value before save:', cleanedProfileData.weight_kg, 'Type:', typeof cleanedProfileData.weight_kg);
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
      console.log('Profile API: Weight unit:', cleanedProfileData.weight_unit);
    }
    
    console.log('Profile API: Cleaned update data:', JSON.stringify(cleanedProfileData, null, 2));
    
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
    console.log('Profile API: Executing database update...');
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

    console.log('Profile API: Update successful:', JSON.stringify(data, null, 2));
    const response = {
      success: true,
      profile: data,
      message: 'Profile updated successfully'
    };
    console.log('Profile API: Returning response:', JSON.stringify(response, null, 2));
    console.log('=== PROFILE API DEBUG END ===\n');
    return NextResponse.json(response);

  } catch (error) {
    console.error('Profile API: Unexpected error:', error);
    console.error('Profile API: Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    return NextResponse.json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      details: error instanceof Error ? error.stack : error
    }, { status: 500 });
  }
}