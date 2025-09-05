import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      userId,
      sportKey = 'general',
      postType = 'media',
      caption = '',
      visibility = 'public',
      golfData = null,
      mediaFiles = []
    } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // Validate sport key
    const validSportKeys = ['general', 'golf', 'ice_hockey', 'volleyball', 'track_field', 'basketball', 'soccer', 'tennis', 'swimming', 'baseball', 'football'];
    if (!validSportKeys.includes(sportKey)) {
      return NextResponse.json({ error: 'Invalid sport key' }, { status: 400 });
    }

    // Validate post type
    if (!['media', 'stats', 'mixed'].includes(postType)) {
      return NextResponse.json({ error: 'Invalid post type' }, { status: 400 });
    }

    // Validate visibility
    if (!['public', 'private'].includes(visibility)) {
      return NextResponse.json({ error: 'Invalid visibility setting' }, { status: 400 });
    }

    // Create the post record
    const postData: any = {
      profile_id: userId,
      sport_key: sportKey,
      post_type: postType,
      caption: caption,
      visibility: visibility
    };

    let roundId = null;
    let holeNumber = null;
    
    // Create golf entities if provided
    if (sportKey === 'golf' && golfData) {
      postData.golf_mode = golfData.mode;
      
      if (golfData.mode === 'round_recap' && golfData.roundData) {
        // Check for existing round on same date/course
        const { data: existingRounds } = await supabase
          .from('golf_rounds')
          .select('id')
          .eq('profile_id', userId)
          .eq('date', golfData.roundData.date)
          .eq('course', golfData.roundData.course)
          .limit(1);

        if (existingRounds && existingRounds.length > 0) {
          // Use existing round
          roundId = existingRounds[0].id;
          
          // Update existing round with new data
          await supabase
            .from('golf_rounds')
            .update({
              tee: golfData.roundData.tee,
              holes: golfData.roundData.holes,
              gross_score: golfData.roundData.grossScore,
              par: golfData.roundData.par,
              fir_percentage: golfData.roundData.firPercentage,
              gir_percentage: golfData.roundData.girPercentage,
              total_putts: golfData.roundData.totalPutts,
              notes: golfData.roundData.notes
            })
            .eq('id', roundId);
        } else {
          // Create new round
          const { data: newRound, error: roundError } = await supabase
            .from('golf_rounds')
            .insert({
              profile_id: userId,
              date: golfData.roundData.date,
              course: golfData.roundData.course,
              tee: golfData.roundData.tee,
              holes: golfData.roundData.holes,
              gross_score: golfData.roundData.grossScore,
              par: golfData.roundData.par,
              fir_percentage: golfData.roundData.firPercentage,
              gir_percentage: golfData.roundData.girPercentage,
              total_putts: golfData.roundData.totalPutts,
              notes: golfData.roundData.notes
            })
            .select()
            .single();

          if (roundError) {
            console.error('Round creation error:', roundError);
          } else {
            roundId = newRound.id;
          }
        }
        
      } else if (golfData.mode === 'hole_highlight' && golfData.holeData) {
        holeNumber = golfData.holeData.holeNumber;
        
        // Check for existing round on same date/course (if course provided)
        let existingRoundId = null;
        if (golfData.holeData.course) {
          const { data: existingRounds } = await supabase
            .from('golf_rounds')
            .select('id')
            .eq('profile_id', userId)
            .eq('date', golfData.holeData.date)
            .eq('course', golfData.holeData.course)
            .limit(1);

          if (existingRounds && existingRounds.length > 0) {
            existingRoundId = existingRounds[0].id;
          }
        }
        
        if (!existingRoundId) {
          // Create minimal round for hole highlight
          const { data: newRound, error: roundError } = await supabase
            .from('golf_rounds')
            .insert({
              profile_id: userId,
              date: golfData.holeData.date,
              course: golfData.holeData.course || `Round from ${golfData.holeData.date}`,
              holes: 18, // Default for hole highlight
              par: 72
            })
            .select()
            .single();

          if (roundError) {
            console.error('Round creation error:', roundError);
          } else {
            existingRoundId = newRound.id;
          }
        }
        
        roundId = existingRoundId;
        
        // Create or update hole record
        if (roundId) {
          const holeData = {
            round_id: roundId,
            hole_number: golfData.holeData.holeNumber,
            par: golfData.holeData.par,
            strokes: golfData.holeData.strokes,
            putts: golfData.holeData.putts,
            fairway_hit: golfData.holeData.fairwayHit,
            green_in_regulation: golfData.holeData.greenInRegulation
          };
          
          // Try to update existing hole first, then insert if doesn't exist
          const { error: updateError } = await supabase
            .from('golf_holes')
            .upsert(holeData, { 
              onConflict: 'round_id,hole_number'
            });
            
          if (updateError) {
            console.error('Hole upsert error:', updateError);
          }
        }
      }
      
      // Add golf references to post
      if (roundId) {
        postData.round_id = roundId;
      }
      if (holeNumber) {
        postData.hole_number = holeNumber;
      }
    }

    const { data: post, error: postError } = await supabase
      .from('posts')
      .insert(postData)
      .select()
      .single();

    if (postError) {
      console.error('Post creation error:', postError);
      return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
    }

    // Add media files if provided
    if (mediaFiles && mediaFiles.length > 0) {
      const mediaRecords = mediaFiles.map((file: any, index: number) => ({
        post_id: post.id,
        file_url: file.url,
        file_type: file.type,
        file_size: file.size,
        display_order: index + 1,
        thumbnail_url: file.thumbnailUrl,
        alt_text: file.altText || ''
      }));

      const { error: mediaError } = await supabase
        .from('post_media')
        .insert(mediaRecords);

      if (mediaError) {
        console.error('Media creation error:', mediaError);
        // Don't fail the entire request, but log the error
      }
    }

    return NextResponse.json({ 
      success: true, 
      post: post,
      message: 'Post created successfully!'
    });

  } catch (error) {
    console.error('Post creation error:', error);
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const sportKey = searchParams.get('sportKey');
    const visibility = searchParams.get('visibility') || 'public';
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!userId && visibility !== 'public') {
      return NextResponse.json({ error: 'User ID required for private posts' }, { status: 400 });
    }

    let query = supabase
      .from('posts')
      .select(`
        *,
        post_media (
          id,
          file_url,
          file_type,
          thumbnail_url,
          alt_text,
          display_order
        ),
        profiles!inner (
          id,
          full_name,
          first_name,
          last_name,
          avatar_url
        ),
        golf_rounds (
          id,
          date,
          course,
          tee,
          holes,
          gross_score,
          par,
          fir_percentage,
          gir_percentage,
          total_putts,
          notes
        ),
        golf_holes (
          id,
          hole_number,
          par,
          strokes,
          putts,
          fairway_hit,
          green_in_regulation
        )
      `)
      .order('created_at', { ascending: false })
      .limit(limit);

    // Filter by user if provided
    if (userId) {
      query = query.eq('profile_id', userId);
    } else {
      // Only show public posts for non-user queries
      query = query.eq('visibility', 'public');
    }

    // Filter by sport if provided
    if (sportKey && sportKey !== 'all') {
      query = query.eq('sport_key', sportKey);
    }

    const { data: posts, error } = await query;

    if (error) {
      console.error('Posts fetch error:', error);
      return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
    }

    return NextResponse.json({ posts: posts || [] });

  } catch (error) {
    console.error('Posts fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch posts' }, { status: 500 });
  }
}