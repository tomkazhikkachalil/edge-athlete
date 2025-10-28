import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { supabaseAdmin } from '@/lib/supabase';

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

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createSupabaseClient(request);

    // 1. Verify user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    // 2. Get and validate request body
    const body = await request.json();
    const { confirmText, password } = body;

    if (!confirmText || !password) {
      return NextResponse.json({
        error: 'Confirmation text and password are required'
      }, { status: 400 });
    }

    // 3. Verify password by re-authenticating
    if (!user.email) {
      return NextResponse.json({ error: 'User email not found' }, { status: 400 });
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (signInError) {
      console.error('Password verification failed:', signInError);
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // 4. Verify admin client is available
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return NextResponse.json({
        error: 'Server configuration error'
      }, { status: 500 });
    }

    // 5. Collect storage file paths before deletion
    const storagePaths: Array<{ bucket: string; paths: string[] }> = [];

    // Get user's avatar path
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('avatar_url')
      .eq('id', userId)
      .single();

    if (profile?.avatar_url) {
      // Extract path from URL (format: https://.../storage/v1/object/public/avatars/path)
      const avatarPath = profile.avatar_url.split('/avatars/')[1];
      if (avatarPath) {
        storagePaths.push({ bucket: 'avatars', paths: [avatarPath] });
      }
    }

    // Get user's post media paths
    const { data: postMedia } = await supabaseAdmin
      .from('post_media')
      .select('media_url')
      .eq('profile_id', userId);

    if (postMedia && postMedia.length > 0) {
      const mediaPaths = postMedia
        .map(m => m.media_url.split('/post-media/')[1])
        .filter(Boolean);

      if (mediaPaths.length > 0) {
        storagePaths.push({ bucket: 'post-media', paths: mediaPaths });
      }
    }


    // 6. Delete data in correct order (using admin client to bypass RLS)
    // Order matters to avoid foreign key constraint violations

    try {
      // Delete engagement data first
      await supabaseAdmin.from('comment_likes').delete().eq('profile_id', userId);
      await supabaseAdmin.from('post_likes').delete().eq('profile_id', userId);
      await supabaseAdmin.from('saved_posts').delete().eq('profile_id', userId);

      // Delete comments (owns comments)
      await supabaseAdmin.from('post_comments').delete().eq('profile_id', userId);

      // Delete notifications (sender and recipient)
      await supabaseAdmin.from('notifications').delete().eq('user_id', userId);
      await supabaseAdmin.from('notifications').delete().eq('actor_id', userId);
      await supabaseAdmin.from('notification_preferences').delete().eq('user_id', userId);

      // Delete follow relationships (both directions)
      await supabaseAdmin.from('follows').delete().eq('follower_id', userId);
      await supabaseAdmin.from('follows').delete().eq('following_id', userId);

      // Delete sport-specific data
      // Golf
      await supabaseAdmin.from('golf_holes').delete().eq('profile_id', userId);
      await supabaseAdmin.from('golf_rounds').delete().eq('profile_id', userId);

      // Generic sport data
      await supabaseAdmin.from('season_highlights').delete().eq('profile_id', userId);
      await supabaseAdmin.from('performances').delete().eq('profile_id', userId);
      await supabaseAdmin.from('athlete_badges').delete().eq('profile_id', userId);
      await supabaseAdmin.from('sport_settings').delete().eq('profile_id', userId);

      // Delete club associations
      await supabaseAdmin.from('athlete_clubs').delete().eq('athlete_id', userId);

      // Delete group post participations
      await supabaseAdmin.from('group_post_participants').delete().eq('participant_id', userId);

      // Delete media metadata
      await supabaseAdmin.from('post_media').delete().eq('profile_id', userId);

      // Delete posts (cascade will handle related data)
      await supabaseAdmin.from('posts').delete().eq('profile_id', userId);

      // Delete profile (this should trigger CASCADE to auth.users via FK)
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .delete()
        .eq('id', userId);

      if (profileError) {
        console.error('[Account Deletion] Profile deletion error:', profileError);
        throw new Error(`Failed to delete profile: ${profileError.message}`);
      }


    } catch (dbError) {
      console.error('[Account Deletion] Database deletion error:', dbError);
      return NextResponse.json({
        error: 'Failed to delete account data',
        details: dbError instanceof Error ? dbError.message : 'Unknown error'
      }, { status: 500 });
    }

    // 7. Delete storage files
    const storageErrors: string[] = [];

    for (const { bucket, paths } of storagePaths) {
      try {
        const { error } = await supabaseAdmin
          .storage
          .from(bucket)
          .remove(paths);

        if (error) {
          console.error(`[Account Deletion] Storage deletion error (${bucket}):`, error);
          storageErrors.push(`${bucket}: ${error.message}`);
        } else {
        }
      } catch (storageError) {
        console.error(`[Account Deletion] Storage error (${bucket}):`, storageError);
        storageErrors.push(`${bucket}: ${storageError instanceof Error ? storageError.message : 'Unknown error'}`);
      }
    }

    // 8. Delete auth user (CRITICAL - must succeed to free up email)
    try {
      const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

      if (authDeleteError) {
        console.error('[Account Deletion] Auth deletion FAILED:', authDeleteError);
        // This is CRITICAL - if auth deletion fails, email remains registered
        return NextResponse.json({
          error: 'Failed to delete authentication user',
          details: authDeleteError.message,
          hint: 'Account data deleted but email may still be reserved. Contact support.'
        }, { status: 500 });
      }

      console.log(`[Account Deletion] Auth user ${userId} deleted successfully`);
    } catch (authError) {
      console.error('[Account Deletion] Auth deletion exception:', authError);
      return NextResponse.json({
        error: 'Failed to delete authentication user',
        details: authError instanceof Error ? authError.message : 'Unknown error',
        hint: 'Account data deleted but email may still be reserved. Contact support.'
      }, { status: 500 });
    }

    // 9. Sign out the user
    await supabase.auth.signOut();


    if (storageErrors.length > 0) {
      console.warn('[Account Deletion] Storage cleanup warnings:', storageErrors);
    }

    return NextResponse.json({
      success: true,
      message: 'Account deleted successfully',
      warnings: storageErrors.length > 0 ? storageErrors : undefined
    });

  } catch (error) {
    console.error('[Account Deletion] Unexpected error:', error);
    return NextResponse.json({
      error: 'Internal server error during account deletion',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
