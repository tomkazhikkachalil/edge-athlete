-- ============================================================================
-- 123: hot-path indexes — ratify the archived performance indexes as numbered SQL
-- ============================================================================
-- The pre-scale hardening audit (Aug 2026) confirmed the highest-fanout tables
-- in the product — follows, post_likes, post_comments, and the posts timeline —
-- have NO indexes in any numbered migration. Those tables were created by
-- archived legacy scripts (see database/archive/), so their index state can't
-- be read from this repo; migration 074 already hit this exact failure mode for
-- post_media(post_id). This migration ratifies the right set from
-- database/archive/old-migrations/add-performance-indexes.sql (marked never-run)
-- into the numbered sequence.
--
-- Every statement is CREATE INDEX IF NOT EXISTS — idempotent, a no-op where the
-- index already exists in prod, so it is safe to run regardless of the
-- unverifiable current state.
--
-- NOT CONCURRENTLY on purpose: the Supabase SQL editor runs a migration as ONE
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside a transaction
-- block. Plain CREATE INDEX takes a brief write lock per table — negligible at
-- current data size. ⚠️ Once these tables are large, create any FURTHER index
-- with CONCURRENTLY, run OUTSIDE a transaction (one statement at a time).
--
-- BEFORE running, capture the current state (read-only):
--   SELECT tablename, indexname, indexdef FROM pg_indexes
--   WHERE schemaname='public'
--     AND tablename IN ('follows','posts','post_likes','post_comments',
--                       'post_media','notifications')
--   ORDER BY tablename, indexname;
-- Re-run it AFTER to confirm the new indexes are present.

-- FOLLOWS — probed on the feed, both follower-count directions, per-post
-- visibility checks, and inside posts_select_policy's correlated subquery.
CREATE INDEX IF NOT EXISTS idx_follows_follower_status  ON follows(follower_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following_status ON follows(following_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_composite        ON follows(follower_id, following_id, status);

-- POST_LIKES — the like/unlike count trigger (mig 015) runs COUNT(*) WHERE
-- post_id = … on every interaction; unindexed post_id = seq scan per like.
CREATE INDEX IF NOT EXISTS idx_post_likes_post    ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_profile ON post_likes(profile_id, created_at DESC);

-- POST_COMMENTS — base comment query (.eq('post_id') + order) and the count
-- trigger; only partial indexes existed (moderation/pinned/parent).
CREATE INDEX IF NOT EXISTS idx_comments_post ON post_comments(post_id, created_at DESC);

-- POSTS — the primary timeline/feed query orders by created_at DESC within a
-- profile (or an IN list). Only partial variants existed (pinned/pending/stat).
CREATE INDEX IF NOT EXISTS idx_posts_profile_created    ON posts(profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visibility_created ON posts(visibility, created_at DESC);
-- Vitals training feed: .eq(profile_id).eq(post_category).order(created_at DESC)
CREATE INDEX IF NOT EXISTS idx_posts_category_profile_created
  ON posts(post_category, profile_id, created_at DESC);

-- POST_MEDIA — profile media tab ordering (the 074 index covered post_id only).
CREATE INDEX IF NOT EXISTS idx_post_media_post_display ON post_media(post_id, display_order ASC);

-- NOTIFICATIONS — the list query is .eq('user_id').order('created_at' DESC);
-- only single-column (user_id) and (created_at DESC) existed separately.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, is_read, created_at DESC) WHERE is_read = false;

-- GOLF_ROUNDS — profile round history ordering.
CREATE INDEX IF NOT EXISTS idx_golf_rounds_profile_date ON golf_rounds(profile_id, date DESC);

-- Unindexed FOREIGN KEYS with ON DELETE CASCADE — every account deletion / row
-- cascade otherwise seq-scans the child table.
CREATE INDEX IF NOT EXISTS idx_posts_group_post_id
  ON posts(group_post_id) WHERE group_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_feed_tokens_profile ON calendar_feed_tokens(profile_id);
CREATE INDEX IF NOT EXISTS idx_club_members_club     ON club_members(club_id);
CREATE INDEX IF NOT EXISTS idx_league_members_league ON league_members(league_id);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at DESC);
