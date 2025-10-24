-- POSTS SCHEMA - Unified Post Creation System
-- Run this in Supabase SQL Editor to add post functionality

-- =====================================================
-- 1. POSTS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  sport_key TEXT NOT NULL DEFAULT 'general', -- 'golf', 'ice_hockey', 'volleyball', 'general'
  post_type TEXT NOT NULL DEFAULT 'media', -- 'media', 'stats', 'mixed'
  caption TEXT,
  visibility TEXT NOT NULL DEFAULT 'public', -- 'public', 'private'
  
  -- Golf-specific fields (null for other sports)
  golf_course TEXT,
  golf_score INTEGER,
  golf_par INTEGER DEFAULT 72,
  golf_fir_percentage DECIMAL(5,2),
  golf_gir_percentage DECIMAL(5,2),
  golf_putts_per_round DECIMAL(4,2),
  golf_round_date DATE,
  golf_round_notes TEXT,
  
  -- Future sport fields can be added here
  -- hockey_goals INTEGER,
  -- volleyball_kills INTEGER,
  -- etc.
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on posts
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view their own posts" ON posts;
DROP POLICY IF EXISTS "Users can view public posts" ON posts;
DROP POLICY IF EXISTS "Users can insert their own posts" ON posts;
DROP POLICY IF EXISTS "Users can update their own posts" ON posts;
DROP POLICY IF EXISTS "Users can delete their own posts" ON posts;

-- RLS Policies for posts
CREATE POLICY "Users can view their own posts" ON posts
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can view public posts" ON posts
  FOR SELECT USING (visibility = 'public');

CREATE POLICY "Users can insert their own posts" ON posts
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update their own posts" ON posts
  FOR UPDATE USING (auth.uid() = profile_id);

CREATE POLICY "Users can delete their own posts" ON posts
  FOR DELETE USING (auth.uid() = profile_id);

-- =====================================================
-- 2. POST MEDIA TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS post_media (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID REFERENCES posts(id) ON DELETE CASCADE NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT NOT NULL, -- 'image', 'video'
  file_size INTEGER,
  display_order INTEGER DEFAULT 1,
  thumbnail_url TEXT, -- For videos
  alt_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS on post_media
ALTER TABLE post_media ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view media for their posts" ON post_media;
DROP POLICY IF EXISTS "Users can view media for public posts" ON post_media;
DROP POLICY IF EXISTS "Users can insert media for their posts" ON post_media;
DROP POLICY IF EXISTS "Users can update media for their posts" ON post_media;
DROP POLICY IF EXISTS "Users can delete media for their posts" ON post_media;

-- RLS Policies for post_media (through posts table)
CREATE POLICY "Users can view media for their posts" ON post_media
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts 
      WHERE posts.id = post_media.post_id 
      AND posts.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can view media for public posts" ON post_media
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts 
      WHERE posts.id = post_media.post_id 
      AND posts.visibility = 'public'
    )
  );

CREATE POLICY "Users can insert media for their posts" ON post_media
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM posts 
      WHERE posts.id = post_media.post_id 
      AND posts.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can update media for their posts" ON post_media
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM posts 
      WHERE posts.id = post_media.post_id 
      AND posts.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete media for their posts" ON post_media
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM posts 
      WHERE posts.id = post_media.post_id 
      AND posts.profile_id = auth.uid()
    )
  );

-- =====================================================
-- 3. INDEXES FOR PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_posts_profile_id ON posts(profile_id);
CREATE INDEX IF NOT EXISTS idx_posts_sport_key ON posts(sport_key);
CREATE INDEX IF NOT EXISTS idx_posts_visibility ON posts(visibility);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON post_media(post_id);
CREATE INDEX IF NOT EXISTS idx_post_media_display_order ON post_media(post_id, display_order);

-- =====================================================
-- 4. FUNCTIONS FOR UPDATED_AT
-- =====================================================

-- Create or replace the updated_at trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add triggers for updated_at
DROP TRIGGER IF EXISTS update_posts_updated_at ON posts;
CREATE TRIGGER update_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();