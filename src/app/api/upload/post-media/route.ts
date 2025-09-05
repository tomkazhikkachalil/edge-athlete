import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const userId = formData.get('userId') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    // File validation
    const maxSize = 50 * 1024 * 1024; // 50MB
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
    const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];

    if (file.size > maxSize) {
      return NextResponse.json({ error: 'File size must be less than 50MB' }, { status: 400 });
    }

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ 
        error: 'Please select a valid image or video file (JPG, PNG, GIF, WebP, MP4, MOV, WebM)' 
      }, { status: 400 });
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `posts/${fileName}`;

    // Upload file to Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('uploads')
      .getPublicUrl(filePath);

    if (!urlData?.publicUrl) {
      return NextResponse.json({ error: 'Failed to get file URL' }, { status: 500 });
    }

    // Generate thumbnail for videos (placeholder for now)
    let thumbnailUrl = null;
    if (allowedVideoTypes.includes(file.type)) {
      // In a real implementation, you'd generate a thumbnail here
      // For now, we'll use a placeholder or the video URL itself
      thumbnailUrl = urlData.publicUrl;
    }

    const fileInfo = {
      id: uploadData.path,
      url: urlData.publicUrl,
      type: allowedImageTypes.includes(file.type) ? 'image' : 'video',
      size: file.size,
      name: file.name,
      thumbnailUrl: thumbnailUrl
    };

    return NextResponse.json({
      success: true,
      file: fileInfo,
      message: 'File uploaded successfully!'
    });

  } catch (error) {
    console.error('File upload error:', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePath = searchParams.get('filePath');
    const userId = searchParams.get('userId');

    if (!filePath || !userId) {
      return NextResponse.json({ error: 'File path and user ID are required' }, { status: 400 });
    }

    // Verify the file belongs to the user (security check)
    if (!filePath.includes(`posts/${userId}/`)) {
      return NextResponse.json({ error: 'Unauthorized file access' }, { status: 403 });
    }

    // Delete file from Supabase Storage
    const { error: deleteError } = await supabase.storage
      .from('uploads')
      .remove([filePath.replace(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/uploads/`, '')]);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully!'
    });

  } catch (error) {
    console.error('File delete error:', error);
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 });
  }
}