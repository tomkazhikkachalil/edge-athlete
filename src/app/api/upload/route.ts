import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { v4 as uuidv4 } from 'uuid';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
// Extensions derived from the validated MIME type — never from the client
// filename (which is attacker-controlled).
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const ALLOWED_VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export async function POST(request: NextRequest) {
  try {
    // Auth required — anonymous uploads were a storage/cost abuse vector.
    const user = await requireAuth(request);
    const userId = user.id;
    const supabase = getSupabaseAdmin();

    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }
    
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large. Maximum size is 5MB' }, { status: 400 });
    }
    
    // Validate file type
    const fileType = file.type;
    const isImage = fileType in ALLOWED_IMAGE_TYPES;
    const isVideo = fileType in ALLOWED_VIDEO_TYPES;

    if (!isImage && !isVideo) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    // Generate unique filename. Always under the authenticated user's prefix —
    // the old `temp/` fallback was an unowned dumping ground (and userId can
    // never be absent here: requireAuth guarantees it).
    const fileExt = isImage ? ALLOWED_IMAGE_TYPES[fileType] : ALLOWED_VIDEO_TYPES[fileType];
    const fileName = `${uuidv4()}.${fileExt}`;
    const filePath = `${userId}/${fileName}`;
    
    // Convert File to ArrayBuffer then to Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('uploads')
      .upload(filePath, buffer, {
        contentType: fileType,
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
    }
    
    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('uploads')
      .getPublicUrl(filePath);
    
    // Return file info
    return NextResponse.json({
      url: publicUrl,
      type: isImage ? 'image' : 'video',
      size: file.size,
      name: file.name,
      path: filePath
    });
    
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('Upload processing error:', err);
    return NextResponse.json({ error: 'Failed to process upload' }, { status: 500 });
  }
}