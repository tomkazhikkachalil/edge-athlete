import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Helper function for cookie authentication (Next.js 15 pattern)
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
 * POST /api/group-posts/[id]/attest
 * Participant attestation - confirm, decline, or maybe for a group post
 * Body:
 *   - status: 'confirmed' | 'declined' | 'maybe' (required)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { status } = body;

    // Validate status
    const validStatuses = ['confirmed', 'declined', 'maybe'];
    if (!status || !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Check if user is a participant in this group post
    const { data: participant, error: participantError } = await supabase
      .from('group_post_participants')
      .select('*')
      .eq('group_post_id', id)
      .eq('profile_id', user.id)
      .single();

    if (participantError || !participant) {
      return NextResponse.json(
        { error: 'You are not a participant in this group post' },
        { status: 404 }
      );
    }

    // Update participant status
    const updates: Record<string, unknown> = {
      status,
    };

    // Set attested_at timestamp for confirmed status
    if (status === 'confirmed') {
      updates.attested_at = new Date().toISOString();
    } else if (status === 'declined') {
      // Clear attestation timestamp if declining
      updates.attested_at = null;
    }

    const { data: updatedParticipant, error: updateError } = await supabase
      .from('group_post_participants')
      .update(updates)
      .eq('group_post_id', id)
      .eq('profile_id', user.id)
      .select(`
        *,
        profile:profile_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          sport,
          school
        )
      `)
      .single();

    if (updateError) {
      console.error('Error updating participant status:', updateError);
      return NextResponse.json({ error: 'Failed to update attestation status' }, { status: 500 });
    }

    // Fetch updated group post for context
    const { data: groupPost } = await supabase
      .from('group_posts')
      .select(`
        id,
        type,
        title,
        date,
        creator:creator_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url
        )
      `)
      .eq('id', id)
      .single();

    return NextResponse.json({
      participant: updatedParticipant,
      group_post: groupPost,
      message: `Participation status updated to ${status}`,
    });
  } catch (error) {
    console.error('Unexpected error in POST /api/group-posts/[id]/attest:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * GET /api/group-posts/[id]/attest
 * Get current user's attestation status for a group post
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createSupabaseClient(request);

  // Verify authentication
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Fetch participant record
    const { data: participant, error: participantError } = await supabase
      .from('group_post_participants')
      .select(`
        *,
        profile:profile_id (
          id,
          full_name,
          first_name,
          middle_name,
          last_name,
          avatar_url,
          sport,
          school
        )
      `)
      .eq('group_post_id', id)
      .eq('profile_id', user.id)
      .single();

    if (participantError || !participant) {
      return NextResponse.json(
        { error: 'You are not a participant in this group post' },
        { status: 404 }
      );
    }

    return NextResponse.json({ participant });
  } catch (error) {
    console.error('Unexpected error in GET /api/group-posts/[id]/attest:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
