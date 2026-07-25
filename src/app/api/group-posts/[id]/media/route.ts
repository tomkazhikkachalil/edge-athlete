import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/auth-server';

/**
 * POST /api/group-posts/[id]/media
 * Attach an already-uploaded photo/video to a round, optionally tagged to a
 * hole. The file itself is uploaded via /api/upload/post-media first; this
 * records the round linkage. User-scoped insert — RLS restricts to the
 * round's participants.
 * Body: { media_url, media_type: 'image'|'video', hole_number?, caption? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = getServerClient(request);

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: groupPostId } = await params;
    const body = await request.json();
    const { media_url, media_type, hole_number, caption } = body;

    if (!media_url || typeof media_url !== 'string') {
      return NextResponse.json({ error: 'media_url is required' }, { status: 400 });
    }
    if (media_type !== 'image' && media_type !== 'video') {
      return NextResponse.json({ error: "media_type must be 'image' or 'video'" }, { status: 400 });
    }
    if (
      hole_number !== undefined &&
      hole_number !== null &&
      (typeof hole_number !== 'number' || hole_number < 1 || hole_number > 18)
    ) {
      return NextResponse.json({ error: 'hole_number must be between 1 and 18' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('group_post_media')
      .insert({
        group_post_id: groupPostId,
        uploaded_by: user.id,
        media_url,
        media_type,
        hole_number: hole_number ?? null,
        caption: typeof caption === 'string' && caption.trim() ? caption.trim() : null,
      })
      .select('id, media_url, media_type, hole_number')
      .single();

    if (error) {
      // RLS denial surfaces here for non-participants
      console.error('group media insert failed:', error);
      return NextResponse.json({ error: 'Could not attach media to this round' }, { status: 403 });
    }

    return NextResponse.json({ media: data }, { status: 201 });
  } catch (error) {
    console.error('Unexpected error in POST /api/group-posts/[id]/media:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
