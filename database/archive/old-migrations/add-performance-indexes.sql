-- ============================================================
-- PERFORMANCE OPTIMIZATION: Database Indexes
-- ============================================================
-- Purpose: Speed up frequently-queried tables to improve page load times
-- Run this in Supabase SQL Editor
-- ============================================================

-- NOTIFICATIONS TABLE INDEXES
-- Used by: /api/notifications/unread-count, /api/notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
ON notifications(user_id, is_read, created_at DESC)
WHERE is_read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
ON notifications(user_id, created_at DESC);

-- FOLLOWS TABLE INDEXES
-- Used by: /api/follow/stats
CREATE INDEX IF NOT EXISTS idx_follows_follower_status
ON follows(follower_id, status);

CREATE INDEX IF NOT EXISTS idx_follows_following_status
ON follows(following_id, status);

CREATE INDEX IF NOT EXISTS idx_follows_composite
ON follows(follower_id, following_id, status);

-- POSTS TABLE INDEXES
-- Used by: feed queries, profile media queries
CREATE INDEX IF NOT EXISTS idx_posts_profile_created
ON posts(profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_posts_visibility_created
ON posts(visibility, created_at DESC);

-- POST MEDIA INDEX
-- Used by: profile media tab queries
CREATE INDEX IF NOT EXISTS idx_post_media_post_display
ON post_media(post_id, display_order ASC);

-- POST LIKES INDEX
-- Used by: like count queries
CREATE INDEX IF NOT EXISTS idx_post_likes_post
ON post_likes(post_id);

CREATE INDEX IF NOT EXISTS idx_post_likes_profile
ON post_likes(profile_id, created_at DESC);

-- COMMENTS INDEX
-- Used by: comment count queries
CREATE INDEX IF NOT EXISTS idx_comments_post
ON post_comments(post_id, created_at DESC);

-- GOLF ROUNDS INDEX
-- Used by: profile media with golf rounds
CREATE INDEX IF NOT EXISTS idx_golf_rounds_profile_date
ON golf_rounds(profile_id, date DESC);

-- PROFILES INDEX
-- Used by: search, user lookups
CREATE INDEX IF NOT EXISTS idx_profiles_handle
ON profiles(handle)
WHERE handle IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_email
ON profiles(email);

-- ANALYTICS: Check index usage after creation
-- Run this after a few days to see which indexes are being used:
/*
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan as index_scans,
  idx_tup_read as tuples_read,
  idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
*/

-- SUCCESS MESSAGE
DO $$
BEGIN
  RAISE NOTICE 'Performance indexes created successfully!';
  RAISE NOTICE 'Expected improvements:';
  RAISE NOTICE '  - Notifications queries: 10x-50x faster';
  RAISE NOTICE '  - Follow stats: 5x-20x faster';
  RAISE NOTICE '  - Profile media: 3x-10x faster';
  RAISE NOTICE 'Test your page load times now!';
END $$;
