-- DIAGNOSE AND FIX FOLLOWS TABLE
-- Run this in Supabase SQL Editor to fix the relationship issues

-- STEP 1: Check if follows table exists
SELECT
  'follows table exists' as status,
  COUNT(*) as row_count
FROM follows;

-- STEP 2: Check current columns
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'follows'
ORDER BY ordinal_position;

-- STEP 3: Check foreign key constraints
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'follows' AND tc.constraint_type = 'FOREIGN KEY';

-- STEP 4: Drop and recreate follows table with proper relationships
-- WARNING: This will delete all follow data! Comment this out if you want to preserve data.

-- First, drop the table if it exists (CASCADE will drop dependent objects)
DROP TABLE IF EXISTS follows CASCADE;

-- Create follows table with proper foreign keys
CREATE TABLE follows (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  follower_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted', 'rejected')),
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(follower_id, following_id)
);

-- Add indexes for performance
CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_following ON follows(following_id);
CREATE INDEX idx_follows_status ON follows(status);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_follows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_follows_updated_at
  BEFORE UPDATE ON follows
  FOR EACH ROW
  EXECUTE FUNCTION update_follows_updated_at();

-- STEP 5: Enable RLS
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own follows"
  ON follows FOR SELECT
  USING (
    auth.uid() = follower_id
    OR auth.uid() = following_id
  );

CREATE POLICY "Users can create follows"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can update their own follows"
  ON follows FOR UPDATE
  USING (auth.uid() = follower_id OR auth.uid() = following_id)
  WITH CHECK (auth.uid() = follower_id OR auth.uid() = following_id);

CREATE POLICY "Users can delete their own follows"
  ON follows FOR DELETE
  USING (auth.uid() = follower_id);

-- STEP 6: Verify the setup
SELECT
  'Setup complete!' as status,
  COUNT(*) as total_follows
FROM follows;

-- STEP 7: Check foreign keys are now present
SELECT
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.table_name = 'follows' AND tc.constraint_type = 'FOREIGN KEY';
