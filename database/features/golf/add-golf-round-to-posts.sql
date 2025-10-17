-- Add golf_rounds relationship to posts table
-- Run this in Supabase SQL Editor

-- Add round_id column to posts table to link to golf_rounds
ALTER TABLE posts ADD COLUMN IF NOT EXISTS round_id UUID REFERENCES golf_rounds(id) ON DELETE SET NULL;

-- Add golf_mode column to track what kind of golf post this is
ALTER TABLE posts ADD COLUMN IF NOT EXISTS golf_mode TEXT CHECK (golf_mode IN ('round_recap', 'hole_highlight', null));

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_posts_round_id ON posts(round_id);

-- Update RLS policy to allow reading golf_rounds through posts
-- Users can view golf rounds associated with posts they can see
DROP POLICY IF EXISTS "Users can view golf rounds through posts" ON golf_rounds;
CREATE POLICY "Users can view golf rounds through posts" ON golf_rounds
  FOR SELECT USING (
    auth.uid() = profile_id OR
    EXISTS (
      SELECT 1 FROM posts
      WHERE posts.round_id = golf_rounds.id
      AND posts.visibility = 'public'
    )
  );
