import { NextRequest, NextResponse } from 'next/server';
import { supabase, supabaseAdmin } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    console.log('Avatar API: Received POST request');
    
    const formData = await request.formData();
    const file = formData.get('avatar') as File;
    const userId = formData.get('userId') as string;
    
    console.log('Avatar API: File received:', file ? `${file.name} (${file.size} bytes, ${file.type})` : 'No file');
    console.log('Avatar API: User ID received:', userId);
    
    if (!file) {
      console.error('Avatar API: No file provided');
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!userId) {
      console.error('Avatar API: No user ID provided');
      return NextResponse.json({ error: 'User ID required' }, { status: 400 });
    }

    // Validate file type
    console.log('Avatar API: Validating file type...');
    if (!file.type.startsWith('image/')) {
      console.error('Avatar API: Invalid file type:', file.type);
      return NextResponse.json({ error: 'File must be an image' }, { status: 400 });
    }

    // Validate file size (5MB max)
    console.log('Avatar API: Validating file size...');
    if (file.size > 5 * 1024 * 1024) {
      console.error('Avatar API: File too large:', file.size, 'bytes');
      return NextResponse.json({ error: 'File size must be less than 5MB' }, { status: 400 });
    }

    const fileExt = file.name.split('.').pop();
    const fileName = `avatar-${userId}-${Date.now()}.${fileExt}`;
    const filePath = `avatars/${fileName}`;

    console.log('Avatar API: Generated file path:', filePath);

    // Convert file to buffer
    console.log('Avatar API: Converting file to buffer...');
    const arrayBuffer = await file.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);

    // Try multiple bucket names to find an existing one
    const bucketNames = ['avatars', 'uploads', 'images', 'files'];
    let uploadError: unknown = null;
    let successBucket = null;

    console.log('Avatar API: Trying storage buckets:', bucketNames);

    for (const bucketName of bucketNames) {
      console.log(`Avatar API: Attempting upload to bucket: ${bucketName}`);
      const result = await supabase.storage
        .from(bucketName)
        .upload(filePath, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (!result.error) {
        console.log(`Avatar API: Successfully uploaded to bucket: ${bucketName}`);
        successBucket = bucketName;
        break;
      } else {
        console.log(`Avatar API: Failed to upload to ${bucketName}:`, result.error.message);
        uploadError = result.error;
      }
    }

    if (!successBucket) {
      console.error('Avatar API: All buckets failed, last error:', uploadError);
      return NextResponse.json({ 
        error: `Upload failed: No available storage bucket. Last error: ${uploadError && typeof uploadError === 'object' && 'message' in uploadError ? uploadError.message : 'Unknown storage error'}`,
        details: {
          triedBuckets: bucketNames,
          lastError: uploadError
        }
      }, { status: 500 });
    }

    console.log('Avatar API: Getting public URL...');
    // Get public URL using the successful bucket
    const { data: publicUrl } = supabase.storage
      .from(successBucket)
      .getPublicUrl(filePath);

    console.log('Avatar API: Public URL data:', publicUrl);

    if (!publicUrl?.publicUrl) {
      console.error('Avatar API: Failed to get public URL');
      return NextResponse.json({ error: 'Failed to get public URL' }, { status: 500 });
    }

    // Update profile with new avatar URL
    console.log('Avatar API: Updating profile with avatar URL...');
    if (supabaseAdmin) {
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({ avatar_url: publicUrl.publicUrl })
        .eq('id', userId);

      if (updateError) {
        console.error('Avatar API: Profile update error:', updateError);
        console.error('Avatar API: Profile update error details:', JSON.stringify(updateError, null, 2));
        // Still return success since file was uploaded
      } else {
        console.log('Avatar API: Profile updated successfully');
      }
    } else {
      console.error('Avatar API: supabaseAdmin not available');
    }

    console.log('Avatar API: Upload complete, returning success');
    return NextResponse.json({
      success: true,
      avatar_url: publicUrl.publicUrl,
      message: 'Avatar uploaded successfully'
    });

  } catch (error) {
    console.error('Avatar API: Unexpected error:', error);
    console.error('Avatar API: Error details:', error instanceof Error ? error.stack : error);
    return NextResponse.json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      details: error instanceof Error ? error.stack : error
    }, { status: 500 });
  }
}