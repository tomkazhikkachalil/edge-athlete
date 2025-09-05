-- FIX STORAGE BUCKET POLICIES
-- Run this in your Supabase SQL Editor to fix the storage permission issues

-- First, drop all existing conflicting policies
DROP POLICY IF EXISTS "Avatar images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own avatars" ON storage.objects;
DROP POLICY IF EXISTS "Upload images are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to uploads bucket" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their uploads" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their uploads" ON storage.objects;
DROP POLICY IF EXISTS "Badge images are publicly accessible" ON storage.objects;

-- Create simplified, working policies for avatars bucket
CREATE POLICY "Public Access"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'avatars' );

CREATE POLICY "User Upload"
  ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'avatars' );

CREATE POLICY "User Update"
  ON storage.objects FOR UPDATE
  USING ( bucket_id = 'avatars' );

CREATE POLICY "User Delete"
  ON storage.objects FOR DELETE
  USING ( bucket_id = 'avatars' );

-- Create policies for uploads bucket too (backup)
CREATE POLICY "Public Access Uploads"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'uploads' );

CREATE POLICY "User Upload to Uploads"
  ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'uploads' );

-- Verify policies were created
SELECT schemaname, tablename, policyname
FROM pg_policies 
WHERE tablename = 'objects' 
AND schemaname = 'storage'
ORDER BY policyname;

-- Check buckets exist
SELECT id, name, public FROM storage.buckets 
WHERE id IN ('avatars', 'uploads')
ORDER BY name;