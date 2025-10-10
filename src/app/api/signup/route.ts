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

    console.log('Checking for existing email:', email.toLowerCase());
    
    // Check for existing emails if admin client is available
    if (supabaseAdmin) {
      // Check profiles table for existing emails (using admin client to bypass RLS)
      const { data: existingProfiles, error: checkError } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('email', email.toLowerCase());

      console.log('Profile check result:', { existingProfiles, checkError });

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
          console.log('Email already exists in auth.users table');
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

    console.log('Proceeding with Supabase Auth signup for:', email);
    
    // Proceed with Supabase Auth signup
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    console.log('Supabase signup result:', { data: data?.user ? { id: data.user.id, email: data.user.email } : null, error });

    if (error) {
      console.error('Supabase auth signup error:', error);
      
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

    // Update the profile with additional data (using admin client to bypass RLS if available)
    if (data.user) {
      const client = supabaseAdmin || supabase;

      // Create a full name from first and last name
      const fullName = [profileData.first_name, profileData.last_name]
        .filter(Boolean)
        .join(' ') || undefined;

      // Prepare update data
      const updateData: Record<string, unknown> = {
        // Original fields
        email: email.toLowerCase(), // Ensure email is set
        first_name: profileData.first_name,
        last_name: profileData.last_name,
        nickname: profileData.nickname,
        phone: profileData.phone,
        birthday: profileData.birthday,
        gender: profileData.gender,
        location: profileData.location,
        postal_code: profileData.postal_code,
        user_type: profileData.user_type || 'athlete',

        // Athlete-specific fields
        full_name: fullName,
        // Use birthday as DOB if provided
        dob: profileData.birthday,
      };

      // Add handle if provided
      if (profileData.handle) {
        updateData.handle = profileData.handle.toLowerCase().trim();
      }

      const { error: profileError } = await client
        .from('profiles')
        .update(updateData)
        .eq('id', data.user.id);

      if (profileError) {
        console.error('Error updating profile:', profileError);

        // Check if it's a handle uniqueness error
        if (profileError.message?.includes('handle') ||
            profileError.message?.includes('duplicate') ||
            profileError.code === '23505') {
          return NextResponse.json(
            { error: 'This handle is already taken. Please choose a different one.' },
            { status: 409 }
          );
        }

        // For other errors, still return success since auth user was created
        console.warn('Profile update failed but user created:', profileError);
      }

      // Log successful profile update for debugging
      console.log('Profile updated for user:', data.user.id, 'with data:', {
        email: email.toLowerCase(),
        full_name: fullName,
        first_name: profileData.first_name,
        last_name: profileData.last_name,
        nickname: profileData.nickname,
        location: profileData.location,
        dob: profileData.birthday,
        handle: profileData.handle
      });
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