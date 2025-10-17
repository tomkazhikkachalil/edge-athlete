-- =====================================================
-- QUICK VERIFICATION SCRIPT
-- Simple, single-location replacement
-- =====================================================
-- STEP 1: Replace ONLY the email below with your test user's email
-- STEP 2: Run this entire script
-- =====================================================

-- 🔽 CHANGE THIS LINE - Replace with your test email
CREATE TEMP TABLE IF NOT EXISTS test_profile AS
SELECT id FROM profiles WHERE email = 'YOUR_EMAIL_HERE';
-- Or use handle instead:
-- SELECT id FROM profiles WHERE handle = 'test_golfer_01';

-- =====================================================
-- A) PROFILE VERIFICATION
-- =====================================================

SELECT '═══════════════════════════════════════' as divider, 'A) PROFILE' as section
UNION ALL
SELECT 'Profile ID:', tp.id::text FROM test_profile tp;

-- Profile Record
SELECT
  'A1) Profile Record' as check,
  p.id,
  p.first_name,
  p.last_name,
  p.full_name,
  p.handle,
  p.email,
  p.visibility,
  CASE WHEN p.avatar_url IS NOT NULL THEN '✅ Has avatar' ELSE '⚠️ No avatar' END as avatar_status,
  p.created_at
FROM profiles p, test_profile tp
WHERE p.id = tp.id;

-- Auth User
SELECT
  'A2) Auth User' as check,
  u.id,
  u.email,
  u.created_at,
  CASE WHEN u.email_confirmed_at IS NOT NULL THEN '✅ Confirmed' ELSE '⚠️ Not confirmed' END as email_status
FROM auth.users u, test_profile tp
WHERE u.id = tp.id;

-- =====================================================
-- B) SPORT SETTINGS
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', 'B) SPORT SETTINGS';

SELECT
  'B1) Sport Settings' as check,
  COUNT(*) as total_settings,
  STRING_AGG(sport_key, ', ') as sports_configured
FROM sport_settings s, test_profile tp
WHERE s.profile_id = tp.id;

-- =====================================================
-- C) POSTS
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', 'C) POSTS';

SELECT
  'C1) Post Summary' as check,
  COUNT(*) as total_posts,
  COUNT(CASE WHEN round_id IS NOT NULL THEN 1 END) as stats_posts,
  COUNT(CASE WHEN round_id IS NULL THEN 1 END) as regular_posts,
  STRING_AGG(DISTINCT sport_key, ', ') as sport_keys,
  STRING_AGG(DISTINCT visibility, ', ') as visibilities
FROM posts p, test_profile tp
WHERE p.profile_id = tp.id;

-- Post Details
SELECT
  'C2) Post Details' as check,
  p.id as post_id,
  LEFT(p.caption, 50) as caption_preview,
  p.sport_key,
  p.visibility,
  CASE WHEN p.round_id IS NOT NULL THEN '✅ Has golf round' ELSE '—' END as golf_data,
  p.likes_count,
  p.comments_count,
  p.created_at
FROM posts p, test_profile tp
WHERE p.profile_id = tp.id
ORDER BY p.created_at DESC;

-- =====================================================
-- D) MEDIA
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', 'D) MEDIA';

SELECT
  'D1) Media Summary' as check,
  COUNT(pm.id) as total_media_files,
  COUNT(DISTINCT pm.post_id) as posts_with_media,
  STRING_AGG(DISTINCT pm.media_type, ', ') as media_types
FROM post_media pm
JOIN posts p ON p.id = pm.post_id
JOIN test_profile tp ON p.profile_id = tp.id;

-- =====================================================
-- E) GOLF ROUNDS
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', 'E) GOLF ROUNDS';

SELECT
  'E1) Golf Summary' as check,
  COUNT(DISTINCT gr.id) as total_rounds,
  COUNT(DISTINCT gh.id) as total_holes,
  STRING_AGG(DISTINCT gr.round_type, ', ') as round_types
FROM test_profile tp
JOIN golf_rounds gr ON gr.profile_id = tp.id
LEFT JOIN golf_holes gh ON gh.round_id = gr.id;

-- Golf Round Details
SELECT
  'E2) Round Details' as check,
  gr.id as round_id,
  gr.date,
  gr.course,
  gr.holes as hole_count,
  gr.round_type,
  gr.total_score,
  gr.par,
  gr.score_vs_par,
  CASE WHEN p.id IS NOT NULL THEN '✅ Linked to post' ELSE '⚠️ Not posted' END as post_status
FROM test_profile tp
JOIN golf_rounds gr ON gr.profile_id = tp.id
LEFT JOIN posts p ON p.round_id = gr.id
ORDER BY gr.date DESC;

-- =====================================================
-- F) FOLLOWS
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', 'F) FOLLOWS';

-- Followers (people following you)
SELECT
  'F1) Followers' as check,
  COUNT(*) as follower_count,
  COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_requests
FROM follows f, test_profile tp
WHERE f.following_id = tp.id;

-- Following (people you follow)
SELECT
  'F2) Following' as check,
  COUNT(*) as following_count,
  COUNT(CASE WHEN status = 'accepted' THEN 1 END) as accepted,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_requests
FROM follows f, test_profile tp
WHERE f.follower_id = tp.id;

-- Follower Details
SELECT
  'F3) Follower Details' as check,
  follower.handle as follower_handle,
  follower.first_name || ' ' || follower.last_name as follower_name,
  f.status,
  f.created_at
FROM test_profile tp
JOIN follows f ON f.following_id = tp.id
JOIN profiles follower ON follower.id = f.follower_id
ORDER BY f.created_at DESC;

-- =====================================================
-- G) LIKES
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', 'G) LIKES';

-- Likes Received
SELECT
  'G1) Likes Received' as check,
  COUNT(*) as total_likes,
  COUNT(DISTINCT pl.profile_id) as unique_likers,
  COUNT(DISTINCT pl.post_id) as posts_liked
FROM post_likes pl
JOIN posts p ON p.id = pl.post_id
JOIN test_profile tp ON p.profile_id = tp.id;

-- Likes Given
SELECT
  'G2) Likes Given' as check,
  COUNT(*) as total_likes_given
FROM post_likes pl, test_profile tp
WHERE pl.profile_id = tp.id;

-- =====================================================
-- H) COMMENTS
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', 'H) COMMENTS';

-- Comments Received
SELECT
  'H1) Comments Received' as check,
  COUNT(*) as total_comments,
  COUNT(DISTINCT c.profile_id) as unique_commenters,
  COUNT(DISTINCT c.post_id) as posts_commented_on,
  COUNT(CASE WHEN c.parent_comment_id IS NOT NULL THEN 1 END) as replies
FROM post_comments c
JOIN posts p ON p.id = c.post_id
JOIN test_profile tp ON p.profile_id = tp.id
WHERE c.profile_id != tp.id;  -- Exclude own comments

-- Comments Made
SELECT
  'H2) Comments Made' as check,
  COUNT(*) as total_comments_made,
  COUNT(CASE WHEN c.parent_comment_id IS NOT NULL THEN 1 END) as replies_made
FROM post_comments c, test_profile tp
WHERE c.profile_id = tp.id;

-- =====================================================
-- I) NOTIFICATIONS
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', 'I) NOTIFICATIONS';

SELECT
  'I1) Notification Summary' as check,
  COUNT(*) as total_notifications,
  COUNT(CASE WHEN is_read THEN 1 END) as read_count,
  COUNT(CASE WHEN NOT is_read THEN 1 END) as unread_count
FROM notifications n, test_profile tp
WHERE n.recipient_id = tp.id;

-- Notification Types
SELECT
  'I2) By Type' as check,
  n.type,
  COUNT(*) as count,
  COUNT(CASE WHEN NOT is_read THEN 1 END) as unread
FROM notifications n, test_profile tp
WHERE n.recipient_id = tp.id
GROUP BY n.type
ORDER BY count DESC;

-- =====================================================
-- J) DATA INTEGRITY CHECKS
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', 'J) INTEGRITY CHECKS';

-- Check for orphaned posts
SELECT
  'J1) Orphaned Posts' as check,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No orphaned posts'
    ELSE '⛔ ' || COUNT(*) || ' orphaned posts found!'
  END as status
FROM posts p
LEFT JOIN profiles pr ON pr.id = p.profile_id
JOIN test_profile tp ON p.profile_id = tp.id
WHERE pr.id IS NULL;

-- Check for orphaned media
SELECT
  'J2) Orphaned Media' as check,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No orphaned media'
    ELSE '⛔ ' || COUNT(*) || ' orphaned media found!'
  END as status
FROM post_media pm
LEFT JOIN posts p ON p.id = pm.post_id
JOIN test_profile tp ON pm.post_id IN (SELECT id FROM posts WHERE profile_id = tp.id)
WHERE p.id IS NULL;

-- Check for orphaned golf holes
SELECT
  'J3) Orphaned Golf Holes' as check,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No orphaned holes'
    ELSE '⛔ ' || COUNT(*) || ' orphaned holes found!'
  END as status
FROM golf_holes gh
LEFT JOIN golf_rounds gr ON gr.id = gh.round_id
JOIN test_profile tp ON gh.round_id IN (SELECT id FROM golf_rounds WHERE profile_id = tp.id)
WHERE gr.id IS NULL;

-- =====================================================
-- K) COMPLETE SUMMARY
-- =====================================================

SELECT '' as divider, '═══════════════════════════════════════' as section
UNION ALL
SELECT '', '✅ VERIFICATION COMPLETE';

SELECT
  'SUMMARY' as section,
  (SELECT COUNT(*) FROM posts WHERE profile_id = tp.id) as posts,
  (SELECT COUNT(*) FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE p.profile_id = tp.id) as media_files,
  (SELECT COUNT(*) FROM golf_rounds WHERE profile_id = tp.id) as golf_rounds,
  (SELECT COUNT(*) FROM follows WHERE following_id = tp.id AND status = 'accepted') as followers,
  (SELECT COUNT(*) FROM follows WHERE follower_id = tp.id AND status = 'accepted') as following,
  (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.profile_id = tp.id) as likes_received,
  (SELECT COUNT(*) FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE p.profile_id = tp.id AND c.profile_id != tp.id) as comments_received,
  (SELECT COUNT(*) FROM notifications WHERE recipient_id = tp.id) as notifications
FROM test_profile tp;

SELECT
  '📋 Review the results above' as instructions,
  'Look for ✅ (success) or ⛔ (failure) indicators' as note;


-- Cleanup
DROP TABLE IF EXISTS test_profile;
