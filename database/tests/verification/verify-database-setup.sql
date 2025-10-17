-- =====================================================
-- VERIFICATION SCRIPT
-- Run this to verify database optimizations are working
-- =====================================================

-- 1. Check how many indexes were created
SELECT
  'Performance Indexes' as check_type,
  count(*) as total
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%';

-- 2. Check if full-text search columns exist
SELECT
  'Search Vector Columns' as check_type,
  count(*) as total
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'search_vector';

-- 3. Check if search functions exist
SELECT
  'Search Functions' as check_type,
  count(*) as total
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE 'search_%';

-- 4. Test profile search function
SELECT
  'Test Profile Search' as check_type,
  count(*) as results_found
FROM search_profiles('test', 5);

-- 5. Test post search function
SELECT
  'Test Post Search' as check_type,
  count(*) as results_found
FROM search_posts('golf', 5);

-- 6. Test club search function
SELECT
  'Test Club Search' as check_type,
  count(*) as results_found
FROM search_clubs('club', 5);

-- =====================================================
-- EXPECTED RESULTS:
-- Performance Indexes: 40+
-- Search Vector Columns: 3 (profiles, posts, clubs)
-- Search Functions: 3 (search_profiles, search_posts, search_clubs)
-- Test searches: Will return count of matching records
-- =====================================================
