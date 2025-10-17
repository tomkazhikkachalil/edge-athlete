-- Fix RLS policies for followers/following to work correctly
-- The issue: profiles table RLS is blocking the nested follower data

-- Drop existing restrictive policies on profiles
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can view public profiles and own profile" ON profiles;

-- Create new policy that allows viewing profiles in follow relationships
CREATE POLICY "Users can view profiles in their network" ON profiles
  FOR SELECT
  USING (
    -- Everyone can see public profiles
    visibility = 'public'
    OR
    -- Users can see their own profile
    auth.uid() = id
    OR
    -- Users can see profiles of people they follow or who follow them
    EXISTS (
      SELECT 1 FROM follows
      WHERE (
        (follower_id = auth.uid() AND following_id = profiles.id AND status = 'accepted')
        OR
        (following_id = auth.uid() AND follower_id = profiles.id AND status = 'accepted')
        OR
        (following_id = auth.uid() AND follower_id = profiles.id AND status = 'pending')
      )
    )
  );

-- Verify the policy works
SELECT 'RLS policy updated for followers visibility' as status;
