import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const profileId = searchParams.get('profileId');
    const limit = parseInt(searchParams.get('limit') || '10');

    if (!profileId) {
      return NextResponse.json({ error: 'Profile ID required' }, { status: 400 });
    }

    // Call the database function to generate suggestions
    const { data: suggestions, error } = await supabase
      .rpc('generate_connection_suggestions', {
        user_profile_id: profileId,
        suggestion_limit: limit
      });

    if (error) {
      console.error('Error generating suggestions:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ suggestions: suggestions || [] });

  } catch (error) {
    console.error('Suggestions fetch error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch suggestions' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { profileId, suggestedProfileId, action } = body;

    if (!profileId || !suggestedProfileId) {
      return NextResponse.json({ error: 'Profile IDs required' }, { status: 400 });
    }

    if (action === 'dismiss') {
      // Dismiss a suggestion
      const { error } = await supabase
        .from('connection_suggestions')
        .upsert({
          profile_id: profileId,
          suggested_profile_id: suggestedProfileId,
          dismissed: true,
          dismissed_at: new Date().toISOString()
        });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: 'Suggestion dismissed' });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (error) {
    console.error('Suggestion action error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to process suggestion action' },
      { status: 500 }
    );
  }
}
