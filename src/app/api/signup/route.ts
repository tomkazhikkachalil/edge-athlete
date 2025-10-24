import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, profileData } = body;


    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    
    // Check for existing emails if admin client is available
    if (supabaseAdmin) {
      // Check profiles table for existing emails (using admin client to bypass RLS)
      const { data: existingProfiles, error: checkError } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('email', email.toLowerCase());


      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Database check error:', checkError);
        return NextResponse.json(
          { error: 'Database error occurred' },
          { status: 500 }
        );
      }

      // If we found any profiles with this email, it's already taken
      if (existingProfiles && existingProfiles.length > 0) {
        // Email already exists in profiles table
        return NextResponse.json(
          { 
            error: 'This email is already registered. Please log in instead.' 
          },
          { status: 409 }
        );
      }

      // Also check auth.users directly using admin client
      const { data: authUsers, error: authCheckError } = await supabaseAdmin.auth.admin.listUsers();
      
      if (!authCheckError && authUsers.users) {
        const existingAuthUser = authUsers.users.find(user => user.email?.toLowerCase() === email.toLowerCase());
        if (existingAuthUser) {
          return NextResponse.json(
            { 
              error: 'This email is already registered. Please log in instead.' 
            },
            { status: 409 }
          );
        }
      }
    } else {
      console.warn('Admin client not available - skipping duplicate email check. Relying on Supabase Auth validation.');
    }


    // Proceed with Supabase Auth signup
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    

    if (error) {
      console.error('[SIGNUP] Supabase auth signup error:', error);
      
      // Handle various Supabase duplicate email errors
      if (error.message.includes('already registered') || 
          error.message.includes('already exists') ||
          error.message.includes('User already registered') ||
          error.message.includes('already been registered') ||
          error.message.includes('Email already') ||
          error.message.includes('duplicate')) {
        return NextResponse.json(
          { 
            error: 'There is already an account registered under this email address. Please use a different email or try logging in.' 
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    // If no user was created, it might be a duplicate
    if (!data.user) {
      return NextResponse.json(
        { 
          error: 'There is already an account registered under this email address. Please use a different email or try logging in.' 
        },
        { status: 409 }
      );
    }

    // Create/update the profile with additional data (using admin client to bypass RLS if available)
    if (data.user) {
      const client = supabaseAdmin || supabase;

      if (!client) {
        console.error('[SIGNUP] No Supabase client available!');
        return NextResponse.json(
          { error: 'Server configuration error: Database client not initialized' },
          { status: 500 }
        );
      }

      // Create a full name from first and last name
      const fullName = [profileData.first_name, profileData.last_name]
        .filter(Boolean)
        .join(' ') || undefined;

      // Prepare complete profile data for INSERT
      const profileData_toInsert = {
        id: data.user.id,
        email: email.toLowerCase(),
        first_name: profileData.first_name,
        last_name: profileData.last_name,
        nickname: profileData.nickname || null,
        phone: profileData.phone || null,
        birthday: profileData.birthday || null,
        dob: profileData.birthday || null,
        gender: profileData.gender || null,
        location: profileData.location || null,
        postal_code: profileData.postal_code || null,
        user_type: profileData.user_type || 'athlete',
        full_name: fullName || null,
        handle: profileData.handle ? profileData.handle.toLowerCase().trim() : null,
      };


      // Directly INSERT the profile (don't wait for trigger)
      // Use upsert to handle race conditions with trigger
      const { error: profileError } = await client
        .from('profiles')
        .upsert(profileData_toInsert, {
          onConflict: 'id',
          ignoreDuplicates: false
        });

      if (profileError) {
        console.error('[SIGNUP] Error updating profile:', profileError);
        console.error('[SIGNUP] Profile error details:', {
          message: profileError.message,
          code: profileError.code,
          details: profileError.details,
          hint: profileError.hint
        });

        // Check if it's a handle uniqueness error
        if (profileError.message?.includes('handle') ||
            profileError.message?.includes('duplicate') ||
            profileError.message?.includes('unique') ||
            profileError.code === '23505') {
          return NextResponse.json(
            { error: 'This handle is already taken. Please choose a different one.' },
            { status: 409 }
          );
        }

        // Check for null value errors
        if (profileError.code === '23502') {
          return NextResponse.json(
            { error: 'Required profile information is missing. Please ensure all required fields are filled.' },
            { status: 400 }
          );
        }

        // Return specific database error instead of generic message
        return NextResponse.json(
          { error: `Database error: ${profileError.message}` },
          { status: 500 }
        );
      } else {
      }
    } else {
      console.warn('[SIGNUP] No user data returned from auth signup');
    }

    return NextResponse.json(
      { message: 'Account created successfully', user: data.user },
      { status: 201 }
    );

  } catch (error: unknown) {
    console.error('Signup API error:', error);
    
    if (error instanceof Error && (error.message?.includes('already registered') || 
        error.message?.includes('already exists') ||
        error.message?.includes('duplicate'))) {
      return NextResponse.json(
        { 
          error: 'There is already an account registered under this email address. Please use a different email or try logging in.' 
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}