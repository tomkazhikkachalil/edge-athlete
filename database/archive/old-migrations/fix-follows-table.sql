-- FIX FOLLOWS TABLE: Add status column for follow request management
-- This adds the missing 'status' column needed for privacy system

-- =====================================================
-- ADD STATUS COLUMN TO FOLLOWS TABLE
-- =====================================================

-- Add status column if it doesn't exist
ALTER TABLE follows
ADD COLUMN IF NOT EXISTS status TEXT
DEFAULT 'accepted'
CHECK (status IN ('pending', 'accepted', 'rejected'));

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_follows_status ON follows(status);
CREATE INDEX IF NOT EXISTS idx_follows_lookup ON follows(follower_id, following_id, status);

-- Update existing follows to 'accepted' status
-- (assumes current follows are all accepted)
UPDATE follows
SET status = 'accepted'
WHERE status IS NULL;

-- =====================================================
-- NOTES ON STATUS VALUES
-- =====================================================

-- Status meanings:
-- 'pending'  : Follow request sent, waiting for approval
-- 'accepted' : Follow request approved, can view content
-- 'rejected' : Follow request denied

-- For public profiles: status is automatically 'accepted'
-- For private profiles: status starts as 'pending', owner must approve

-- =====================================================
-- UPDATE FOLLOWS RLS POLICIES (if needed)
-- =====================================================

-- Users can view their own follows (sent and received)
DROP POLICY IF EXISTS "Users can view their follows" ON follows;
CREATE POLICY "Users can view their follows" ON follows
  FOR SELECT USING (
    follower_id = auth.uid() OR following_id = auth.uid()
  );

-- Users can create follows (send follow requests)
DROP POLICY IF EXISTS "Users can create follows" ON follows;
CREATE POLICY "Users can create follows" ON follows
  FOR INSERT WITH CHECK (follower_id = auth.uid());

-- Users can update follows they receive (accept/reject)
DROP POLICY IF EXISTS "Users can update follows they receive" ON follows;
CREATE POLICY "Users can update follows they receive" ON follows
  FOR UPDATE USING (following_id = auth.uid());

-- Users can delete their own follows (unfollow or cancel request)
DROP POLICY IF EXISTS "Users can delete their follows" ON follows;
CREATE POLICY "Users can delete their follows" ON follows
  FOR DELETE USING (follower_id = auth.uid());

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check follows table structure
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'follows'
ORDER BY ordinal_position;

-- Check existing follows
SELECT
  f.id,
  f.follower_id,
  f.following_id,
  f.status,
  p1.full_name as follower_name,
  p2.full_name as following_name
FROM follows f
LEFT JOIN profiles p1 ON p1.id = f.follower_id
LEFT JOIN profiles p2 ON p2.id = f.following_id
ORDER BY f.created_at DESC
LIMIT 10;

-- Count follows by status
SELECT
  status,
  COUNT(*) as count
FROM follows
GROUP BY status;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Follows table updated successfully!';
  RAISE NOTICE '✅ Status column added with default "accepted"';
  RAISE NOTICE '✅ Indexes created for performance';
  RAISE NOTICE '✅ RLS policies updated';
  RAISE NOTICE '✅ Now you can run implement-privacy-system.sql';
END $$;
