-- Create follows table for athlete following relationships
CREATE TABLE IF NOT EXISTS follows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  
  -- Ensure unique follow relationships
  UNIQUE(follower_id, following_id),
  
  -- Prevent self-follows
  CHECK (follower_id != following_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS follows_follower_id_idx ON follows(follower_id);
CREATE INDEX IF NOT EXISTS follows_following_id_idx ON follows(following_id);
CREATE INDEX IF NOT EXISTS follows_created_at_idx ON follows(created_at DESC);

-- Enable RLS
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view all follow relationships (public data)
CREATE POLICY "Users can view all follows" ON follows
  FOR SELECT USING (true);

-- Users can only create follows where they are the follower
CREATE POLICY "Users can create their own follows" ON follows
  FOR INSERT WITH CHECK (auth.uid() = follower_id);

-- Users can only delete follows where they are the follower
CREATE POLICY "Users can delete their own follows" ON follows
  FOR DELETE USING (auth.uid() = follower_id);

-- Add follower/following counts to profiles (virtual columns via views)
-- We'll add these counts dynamically in queries rather than storing them
-- to avoid complex triggers and maintain data consistency