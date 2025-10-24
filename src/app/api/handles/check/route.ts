import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const handle = searchParams.get('handle');
    const currentUserId = searchParams.get('currentUserId');

    if (!handle) {
      return NextResponse.json(
        { error: 'Handle is required' },
        { status: 400 }
      );
    }

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
