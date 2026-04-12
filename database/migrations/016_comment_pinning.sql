-- =====================================================
-- Add comment pinning support
-- =====================================================
-- Post owners can pin one comment to the top of the
-- comment section. Enforced at API level (one per post).
-- =====================================================

ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- Partial index: quickly find the pinned comment for a post
CREATE INDEX IF NOT EXISTS idx_post_comments_is_pinned
  ON post_comments(post_id) WHERE is_pinned = TRUE;
