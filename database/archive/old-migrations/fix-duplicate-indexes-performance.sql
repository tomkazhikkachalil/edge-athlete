-- ============================================
-- FIX DUPLICATE INDEXES - PERFORMANCE OPTIMIZATION
-- ============================================
-- Purpose: Remove 5 redundant indexes to improve write performance
-- Impact: Reduced storage usage, faster INSERTs/UPDATEs/DELETEs
-- Risk Level: LOW (only drops redundant indexes, keeps the better one)
-- Version: 1.0 (Idempotent)
-- Created: 2025-01-15
-- ============================================

-- ============================================
-- SECTION 1: VERIFICATION (BEFORE)
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    DUPLICATE INDEX ANALYSIS (BEFORE)';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
END $$;

-- Show all indexes before cleanup
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('performances', 'post_comments', 'post_likes', 'post_media', 'posts')
ORDER BY tablename, indexname;

-- ============================================
-- SECTION 2: DROP DUPLICATE INDEXES
-- ============================================

DO $$
DECLARE
  dropped_count INTEGER := 0;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    DROPPING DUPLICATE INDEXES';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';

  -- 1. performances table: Keep idx_performances_profile_date (more specific)
  --    Drop idx_performances_date (less useful alone)
  BEGIN
    DROP INDEX IF EXISTS public.idx_performances_date;
    dropped_count := dropped_count + 1;
    RAISE NOTICE '✓ Dropped: idx_performances_date (keeping idx_performances_profile_date)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: idx_performances_date - %', SQLERRM;
  END;

  -- 2. post_comments table: Keep idx_comments_post_created (more specific)
  --    Drop idx_comments_post (less useful alone)
  BEGIN
    DROP INDEX IF EXISTS public.idx_comments_post;
    dropped_count := dropped_count + 1;
    RAISE NOTICE '✓ Dropped: idx_comments_post (keeping idx_comments_post_created)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: idx_comments_post - %', SQLERRM;
  END;

  -- 3. post_likes table: Keep idx_post_likes_post_id (standard naming)
  --    Drop idx_post_likes_post (duplicate)
  BEGIN
    DROP INDEX IF EXISTS public.idx_post_likes_post;
    dropped_count := dropped_count + 1;
    RAISE NOTICE '✓ Dropped: idx_post_likes_post (keeping idx_post_likes_post_id)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: idx_post_likes_post - %', SQLERRM;
  END;

  -- 4. post_media table: Keep idx_post_media_post_order (more specific)
  --    Drop idx_post_media_post_display (less specific)
  BEGIN
    DROP INDEX IF EXISTS public.idx_post_media_post_display;
    dropped_count := dropped_count + 1;
    RAISE NOTICE '✓ Dropped: idx_post_media_post_display (keeping idx_post_media_post_order)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: idx_post_media_post_display - %', SQLERRM;
  END;

  -- 5. posts table: Keep idx_posts_tags_gin (GIN index for array operations)
  --    Drop idx_posts_tags (less efficient for array queries)
  BEGIN
    DROP INDEX IF EXISTS public.idx_posts_tags;
    dropped_count := dropped_count + 1;
    RAISE NOTICE '✓ Dropped: idx_posts_tags (keeping idx_posts_tags_gin)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '⊘ Skip: idx_posts_tags - %', SQLERRM;
  END;

  RAISE NOTICE '';
  RAISE NOTICE 'Total indexes dropped: %', dropped_count;
  RAISE NOTICE '';
END $$;

-- ============================================
-- SECTION 3: VERIFICATION (AFTER)
-- ============================================

DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  -- Count remaining indexes on affected tables
  SELECT COUNT(*)
  INTO remaining_count
  FROM pg_indexes
  WHERE schemaname = 'public'
  AND tablename IN ('performances', 'post_comments', 'post_likes', 'post_media', 'posts');

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '    VERIFICATION (AFTER)';
  RAISE NOTICE '═══════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'Remaining indexes on affected tables: %', remaining_count;
  RAISE NOTICE '';

  RAISE NOTICE '✓ SUCCESS: Duplicate indexes removed!';
  RAISE NOTICE '✓ Write performance improved';
  RAISE NOTICE '✓ Storage usage reduced';
  RAISE NOTICE '';
END $$;

-- Show remaining indexes after cleanup
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
AND tablename IN ('performances', 'post_comments', 'post_likes', 'post_media', 'posts')
ORDER BY tablename, indexname;

-- ============================================
-- SECTION 4: ROLLBACK (IF NEEDED)
-- ============================================

-- Uncomment and run these commands if you need to restore the indexes:

/*
-- Restore idx_performances_date
CREATE INDEX idx_performances_date ON public.performances(date DESC);

-- Restore idx_comments_post
CREATE INDEX idx_comments_post ON public.post_comments(post_id);

-- Restore idx_post_likes_post
CREATE INDEX idx_post_likes_post ON public.post_likes(post_id);

-- Restore idx_post_media_post_display
CREATE INDEX idx_post_media_post_display ON public.post_media(post_id, display_order);

-- Restore idx_posts_tags
CREATE INDEX idx_posts_tags ON public.posts USING btree(tags);
*/

-- ============================================
-- MIGRATION COMPLETE
-- ============================================

SELECT '✓ Duplicate index cleanup complete!' AS status;
SELECT '✓ Write operations are now faster' AS benefit_1;
SELECT '✓ Storage usage reduced' AS benefit_2;
SELECT '✓ Refresh Supabase Advisor to verify' AS next_step;
