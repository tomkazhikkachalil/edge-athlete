-- CREATE MISSING STORAGE BUCKETS
-- Run this in your Supabase SQL Editor to create the required storage buckets

-- First, let's check what buckets currently exist
SELECT id, name, public, allowed_mime_types, file_size_limit 
FROM storage.buckets 
ORDER BY name;

-- Create avatars bucket if it doesn't exist
INSERT INTO storage.buckets (
  id, 
  name, 
  public, 
  allowed_mime_types, 
  file_size_limit
) VALUES (
  'avatars', 
  'avatars', 
  true, 
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'], 
  5242880  -- 5MB in bytes
)
ON CONFLICT (id) DO UPDATE SET 
  public = EXCLUDED.public,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  file_size_limit = EXCLUDED.file_size_limit;

-- Create uploads bucket as backup
INSERT INTO storage.buckets (
  id, 
  name, 
  public, 
  allowed_mime_types, 
  file_size_limit
) VALUES (
  'uploads', 
  'uploads', 
  true, 
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp'], 
  5242880  -- 5MB in bytes
)
ON CONFLICT (id) DO UPDATE SET 
  public = EXCLUDED.public,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  file_size_limit = EXCLUDED.file_size_limit;

-- Create storage policies for avatars bucket
CREATE POLICY "Avatar images are publicly accessible" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatars" 
  ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Users can update their own avatars" 
  ON storage.objects FOR UPDATE 
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can delete their own avatars" 
  ON storage.objects FOR DELETE 
  USING (bucket_id = 'avatars');

-- Create storage policies for uploads bucket
CREATE POLICY "Upload images are publicly accessible" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'uploads');

CREATE POLICY "Users can upload to uploads bucket" 
  ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'uploads');

CREATE POLICY "Users can update their uploads" 
  ON storage.objects FOR UPDATE 
  USING (bucket_id = 'uploads');

CREATE POLICY "Users can delete their uploads" 
  ON storage.objects FOR DELETE 
  USING (bucket_id = 'uploads');

-- Verify buckets were created
SELECT 'Buckets created successfully!' as status;
SELECT id, name, public, allowed_mime_types, file_size_limit 
FROM storage.buckets 
WHERE id IN ('avatars', 'uploads')
ORDER BY name;