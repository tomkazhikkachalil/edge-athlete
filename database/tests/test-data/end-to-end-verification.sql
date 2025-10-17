-- =====================================================
-- END-TO-END VERIFICATION SCRIPT
-- Validates all data associations for new profile creation
-- =====================================================
-- USAGE:
-- 1. Create a test user and note their profile_id
-- 2. Find and replace 'YOUR_PROFILE_ID_HERE' with your actual UUID throughout this file
--    (Use Ctrl+F or Cmd+F to find and replace all)
-- 3. Run this entire script after performing all test actions
-- 4. Review the output to confirm all associations are correct
-- =====================================================

-- IMPORTANT: Replace YOUR_PROFILE_ID_HERE with your actual UUID below
-- Example: 'a1b2c3d4-5678-90ab-cdef-1234567890ab'

-- =====================================================
-- A) PROFILE VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'A) PROFILE VERIFICATION' as section;

-- A1) Profile exists and has correct data
SELECT
  'A1) Profile Record' as check,
  id,
  first_name,
  last_name,
  full_name,
  handle,
  email,
  visibility,
  avatar_url,
  created_at
FROM profiles
WHERE id = 'YOUR_PROFILE_ID_HERE';

-- A2) Auth user exists
SELECT
  'A2) Auth User' as check,
  id,
  email,
  created_at,
  email_confirmed_at
FROM auth.users
WHERE id = 'YOUR_PROFILE_ID_HERE';

-- =====================================================
-- B) SPORT SETTINGS VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'B) SPORT SETTINGS' as section;

-- B1) Sport settings exist for this profile
SELECT
  'B1) Sport Settings Records' as check,
  id,
  profile_id,
  sport_key,
  settings,
  created_at,
  updated_at
FROM sport_settings
WHERE profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY sport_key;

-- Expected: At least one row if user has configured any sport (e.g., golf)

-- =====================================================
-- C) POSTS VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'C) POSTS' as section;

-- C1) All posts created by this profile
SELECT
  'C1) Posts by Profile' as check,
  p.id as post_id,
  p.profile_id,
  p.sport_key,
  p.caption,
  p.visibility,
  p.round_id,
  p.stats_data,
  p.likes_count,
  p.comments_count,
  p.saves_count,
  p.created_at,
  CASE
    WHEN p.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Owner'
    ELSE '⛔ WRONG OWNER!'
  END as ownership_check
FROM posts p
WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY p.created_at DESC;

-- Expected: 3 posts (text+media, stats-only, text-only)
-- All should have profile_id = test_profile_id

-- C2) Post type breakdown
SELECT
  'C2) Post Type Breakdown' as check,
  COUNT(*) as total_posts,
  COUNT(CASE WHEN round_id IS NOT NULL THEN 1 END) as stats_posts,
  COUNT(CASE WHEN round_id IS NULL THEN 1 END) as non_stats_posts
FROM posts
WHERE profile_id = 'YOUR_PROFILE_ID_HERE';

-- =====================================================
-- D) MEDIA VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'D) MEDIA' as section;

-- D1) All media linked to posts by this profile
SELECT
  'D1) Post Media' as check,
  pm.id as media_id,
  pm.post_id,
  pm.media_url,
  pm.media_type,
  pm.display_order,
  p.profile_id,
  CASE
    WHEN p.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Owner'
    ELSE '⛔ WRONG OWNER!'
  END as ownership_check
FROM post_media pm
JOIN posts p ON p.id = pm.post_id
WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY pm.post_id, pm.display_order;

-- Expected: At least 1 media file for the text+media post

-- D2) Media count per post
SELECT
  'D2) Media Count by Post' as check,
  p.id as post_id,
  p.caption,
  COUNT(pm.id) as media_count
FROM posts p
LEFT JOIN post_media pm ON pm.post_id = p.id
WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE'
GROUP BY p.id, p.caption
ORDER BY p.created_at DESC;

-- =====================================================
-- E) GOLF PERFORMANCE VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'E) GOLF ROUNDS' as section;

-- E1) Golf rounds for this profile
SELECT
  'E1) Golf Rounds' as check,
  gr.id as round_id,
  gr.profile_id,
  gr.date,
  gr.course,
  gr.course_location,
  gr.holes,
  gr.round_type,
  gr.total_score,
  gr.total_putts,
  gr.par,
  gr.score_vs_par,
  CASE
    WHEN gr.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Owner'
    ELSE '⛔ WRONG OWNER!'
  END as ownership_check
FROM golf_rounds gr
WHERE gr.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY gr.date DESC;

-- Expected: At least 1 round for stats-only post

-- E2) Golf holes for rounds
SELECT
  'E2) Golf Holes' as check,
  gh.id as hole_id,
  gh.round_id,
  gh.hole_number,
  gh.par,
  gh.strokes,
  gh.putts,
  gh.fairway_hit,
  gh.green_in_regulation,
  gr.profile_id,
  CASE
    WHEN gr.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Owner'
    ELSE '⛔ WRONG OWNER!'
  END as ownership_check
FROM golf_holes gh
JOIN golf_rounds gr ON gr.id = gh.round_id
WHERE gr.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY gh.round_id, gh.hole_number;

-- E3) Posts linked to golf rounds
SELECT
  'E3) Posts with Golf Rounds' as check,
  p.id as post_id,
  p.round_id,
  gr.course,
  gr.total_score,
  CASE
    WHEN p.profile_id = 'YOUR_PROFILE_ID_HERE' AND gr.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Both Match'
    ELSE '⛔ MISMATCH!'
  END as ownership_check
FROM posts p
JOIN golf_rounds gr ON gr.id = p.round_id
WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE';

-- =====================================================
-- F) FOLLOWS VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'F) FOLLOWS' as section;

-- F1) Who follows this profile
SELECT
  'F1) Followers of Test Profile' as check,
  f.id as follow_id,
  f.follower_id,
  follower.handle as follower_handle,
  follower.first_name as follower_first_name,
  f.following_id,
  f.status,
  f.created_at,
  CASE
    WHEN f.following_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Following'
    ELSE '⛔ WRONG FOLLOWING!'
  END as relationship_check
FROM follows f
JOIN profiles follower ON follower.id = f.follower_id
WHERE f.following_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY f.created_at DESC;

-- Expected: At least 1 row for viewer_02 → test_golfer_01

-- F2) Who this profile follows
SELECT
  'F2) Following by Test Profile' as check,
  f.id as follow_id,
  f.follower_id,
  f.following_id,
  following.handle as following_handle,
  following.first_name as following_first_name,
  f.status,
  f.created_at,
  CASE
    WHEN f.follower_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Follower'
    ELSE '⛔ WRONG FOLLOWER!'
  END as relationship_check
FROM follows f
JOIN profiles following ON following.id = f.following_id
WHERE f.follower_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY f.created_at DESC;

-- =====================================================
-- G) LIKES VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'G) LIKES' as section;

-- G1) Likes on posts by this profile (received likes)
SELECT
  'G1) Likes Received on Posts' as check,
  pl.id as like_id,
  pl.post_id,
  pl.profile_id as liker_id,
  liker.handle as liker_handle,
  p.profile_id as post_owner_id,
  pl.created_at,
  CASE
    WHEN p.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Post Owner'
    ELSE '⛔ WRONG POST OWNER!'
  END as ownership_check
FROM post_likes pl
JOIN posts p ON p.id = pl.post_id
JOIN profiles liker ON liker.id = pl.profile_id
WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY pl.created_at DESC;

-- Expected: Likes from viewer_02 on the 3 posts

-- G2) Likes given by this profile
SELECT
  'G2) Likes Given by Profile' as check,
  pl.id as like_id,
  pl.post_id,
  pl.profile_id as liker_id,
  p.profile_id as post_owner_id,
  owner.handle as post_owner_handle,
  pl.created_at,
  CASE
    WHEN pl.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Liker'
    ELSE '⛔ WRONG LIKER!'
  END as ownership_check
FROM post_likes pl
JOIN posts p ON p.id = pl.post_id
JOIN profiles owner ON owner.id = p.profile_id
WHERE pl.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY pl.created_at DESC;

-- =====================================================
-- H) COMMENTS VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'H) COMMENTS' as section;

-- H1) Comments on posts by this profile (received comments)
SELECT
  'H1) Comments Received on Posts' as check,
  c.id as comment_id,
  c.post_id,
  c.profile_id as commenter_id,
  commenter.handle as commenter_handle,
  c.content,
  c.parent_comment_id,
  c.likes_count,
  p.profile_id as post_owner_id,
  c.created_at,
  CASE
    WHEN p.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Post Owner'
    ELSE '⛔ WRONG POST OWNER!'
  END as ownership_check
FROM post_comments c
JOIN posts p ON p.id = c.post_id
JOIN profiles commenter ON commenter.id = c.profile_id
WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY c.created_at DESC;

-- Expected: Comments from viewer_02 on the 3 posts

-- H2) Comments made by this profile
SELECT
  'H2) Comments Made by Profile' as check,
  c.id as comment_id,
  c.post_id,
  c.profile_id as commenter_id,
  c.content,
  c.parent_comment_id,
  p.profile_id as post_owner_id,
  owner.handle as post_owner_handle,
  c.created_at,
  CASE
    WHEN c.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Commenter'
    ELSE '⛔ WRONG COMMENTER!'
  END as ownership_check
FROM post_comments c
JOIN posts p ON p.id = c.post_id
JOIN profiles owner ON owner.id = p.profile_id
WHERE c.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY c.created_at DESC;

-- Expected: At least 1 reply from test_golfer_01

-- H3) Comment likes
SELECT
  'H3) Comment Likes' as check,
  cl.id as like_id,
  cl.comment_id,
  cl.profile_id as liker_id,
  liker.handle as liker_handle,
  c.profile_id as comment_owner_id,
  commenter.handle as comment_owner_handle,
  cl.created_at
FROM comment_likes cl
JOIN post_comments c ON c.id = cl.comment_id
JOIN profiles liker ON liker.id = cl.profile_id
JOIN profiles commenter ON commenter.id = c.profile_id
WHERE c.profile_id = 'YOUR_PROFILE_ID_HERE'
   OR cl.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY cl.created_at DESC;

-- =====================================================
-- I) NOTIFICATIONS VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'I) NOTIFICATIONS' as section;

-- I1) Notifications received by this profile
SELECT
  'I1) Notifications Received' as check,
  n.id as notification_id,
  n.recipient_id,
  n.actor_id,
  actor.handle as actor_handle,
  n.type,
  n.entity_type,
  n.entity_id,
  n.is_read,
  n.created_at,
  CASE
    WHEN n.recipient_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Recipient'
    ELSE '⛔ WRONG RECIPIENT!'
  END as recipient_check
FROM notifications n
JOIN profiles actor ON actor.id = n.actor_id
WHERE n.recipient_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY n.created_at DESC;

-- Expected: Notifications for follow, likes, comments from viewer_02

-- I2) Notification type breakdown
SELECT
  'I2) Notification Types' as check,
  type,
  COUNT(*) as count,
  SUM(CASE WHEN is_read THEN 1 ELSE 0 END) as read_count,
  SUM(CASE WHEN NOT is_read THEN 1 ELSE 0 END) as unread_count
FROM notifications
WHERE recipient_id = 'YOUR_PROFILE_ID_HERE'
GROUP BY type
ORDER BY count DESC;

-- Expected types: follow_request/new_follower, post_like, post_comment

-- I3) Notification preferences
SELECT
  'I3) Notification Preferences' as check,
  profile_id,
  notification_type,
  enabled,
  updated_at
FROM notification_preferences
WHERE profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY notification_type;

-- =====================================================
-- J) SAVED POSTS VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'J) SAVED POSTS' as section;

-- J1) Posts saved by this profile
SELECT
  'J1) Saved Posts' as check,
  sp.id as saved_id,
  sp.profile_id as saver_id,
  sp.post_id,
  p.caption,
  p.profile_id as post_owner_id,
  owner.handle as post_owner_handle,
  sp.created_at,
  CASE
    WHEN sp.profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Saver'
    ELSE '⛔ WRONG SAVER!'
  END as ownership_check
FROM saved_posts sp
JOIN posts p ON p.id = sp.post_id
JOIN profiles owner ON owner.id = p.profile_id
WHERE sp.profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY sp.created_at DESC;

-- =====================================================
-- K) TAGGED PROFILES VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'K) TAGGED PROFILES' as section;

-- K1) Posts where this profile is tagged
SELECT
  'K1) Tagged in Posts' as check,
  pt.id as tag_id,
  pt.post_id,
  p.caption,
  p.profile_id as post_owner_id,
  owner.handle as post_owner_handle,
  pt.tagged_profile_id,
  pt.status,
  pt.created_at,
  CASE
    WHEN pt.tagged_profile_id = 'YOUR_PROFILE_ID_HERE' THEN '✅ Correct Tagged Profile'
    ELSE '⛔ WRONG TAGGED PROFILE!'
  END as tag_check
FROM post_tags pt
JOIN posts p ON p.id = pt.post_id
JOIN profiles owner ON owner.id = p.profile_id
WHERE pt.tagged_profile_id = 'YOUR_PROFILE_ID_HERE'
ORDER BY pt.created_at DESC;

-- K2) Tags in posts by this profile
SELECT
  'K2) Tags in Own Posts' as check,
  p.id as post_id,
  p.caption,
  array_agg(tagged.handle ORDER BY tagged.handle) as tagged_handles
FROM posts p
LEFT JOIN LATERAL unnest(p.tags) AS tag_id ON true
LEFT JOIN profiles tagged ON tagged.id = tag_id::uuid
WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE'
GROUP BY p.id, p.caption
HAVING array_length(p.tags, 1) > 0
ORDER BY p.created_at DESC;

-- =====================================================
-- L) SEARCH & AGGREGATION VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'L) SEARCH & AGGREGATION' as section;

-- L1) Profile appears in search
SELECT
  'L1) Profile in Search Results' as check,
  id,
  handle,
  first_name,
  last_name,
  search_vector IS NOT NULL as has_search_vector
FROM profiles
WHERE id = 'YOUR_PROFILE_ID_HERE';

-- L2) Posts appear in feed queries
SELECT
  'L2) Posts in Feed Query' as check,
  COUNT(*) as total_posts,
  COUNT(CASE WHEN visibility = 'public' THEN 1 END) as public_posts,
  COUNT(CASE WHEN visibility = 'private' THEN 1 END) as private_posts
FROM posts
WHERE profile_id = 'YOUR_PROFILE_ID_HERE';

-- =====================================================
-- M) PRIVACY VERIFICATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'M) PRIVACY CHECKS' as section;

-- M1) Profile visibility status
SELECT
  'M1) Profile Privacy' as check,
  id,
  handle,
  visibility,
  CASE
    WHEN visibility = 'public' THEN '✅ Public (content visible to all)'
    WHEN visibility = 'private' THEN '✅ Private (content restricted)'
    ELSE '⚠️  Unknown visibility status'
  END as privacy_status
FROM profiles
WHERE id = 'YOUR_PROFILE_ID_HERE';

-- M2) Post visibility breakdown
SELECT
  'M2) Post Privacy Breakdown' as check,
  visibility,
  COUNT(*) as post_count
FROM posts
WHERE profile_id = 'YOUR_PROFILE_ID_HERE'
GROUP BY visibility;

-- =====================================================
-- N) SUMMARY STATISTICS
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'N) SUMMARY STATISTICS' as section;

-- N1) Complete profile stats
SELECT
  'N1) Profile Summary' as check,
  (SELECT COUNT(*) FROM posts WHERE profile_id = 'YOUR_PROFILE_ID_HERE') as total_posts,
  (SELECT COUNT(*) FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE') as total_media,
  (SELECT COUNT(*) FROM golf_rounds WHERE profile_id = 'YOUR_PROFILE_ID_HERE') as golf_rounds,
  (SELECT COUNT(*) FROM follows WHERE following_id = 'YOUR_PROFILE_ID_HERE' AND status = 'accepted') as follower_count,
  (SELECT COUNT(*) FROM follows WHERE follower_id = 'YOUR_PROFILE_ID_HERE' AND status = 'accepted') as following_count,
  (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE') as likes_received,
  (SELECT COUNT(*) FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE' AND c.profile_id != 'YOUR_PROFILE_ID_HERE') as comments_received,
  (SELECT COUNT(*) FROM notifications WHERE recipient_id = 'YOUR_PROFILE_ID_HERE') as total_notifications,
  (SELECT COUNT(*) FROM notifications WHERE recipient_id = 'YOUR_PROFILE_ID_HERE' AND NOT is_read) as unread_notifications;

-- =====================================================
-- O) FOREIGN KEY VALIDATION
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  'O) FOREIGN KEY INTEGRITY' as section;

-- O1) Check for orphaned posts (posts without valid profiles)
SELECT
  'O1) Orphaned Posts' as check,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No orphaned posts'
    ELSE '⛔ ' || COUNT(*) || ' orphaned posts found!'
  END as status,
  COUNT(*) as orphan_count
FROM posts p
LEFT JOIN profiles pr ON pr.id = p.profile_id
WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE' AND pr.id IS NULL;

-- O2) Check for orphaned media (media without valid posts)
SELECT
  'O2) Orphaned Media' as check,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No orphaned media'
    ELSE '⛔ ' || COUNT(*) || ' orphaned media found!'
  END as status,
  COUNT(*) as orphan_count
FROM post_media pm
LEFT JOIN posts p ON p.id = pm.post_id
WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE' AND p.id IS NULL;

-- O3) Check for orphaned golf holes (holes without valid rounds)
SELECT
  'O3) Orphaned Golf Holes' as check,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No orphaned holes'
    ELSE '⛔ ' || COUNT(*) || ' orphaned holes found!'
  END as status,
  COUNT(*) as orphan_count
FROM golf_holes gh
LEFT JOIN golf_rounds gr ON gr.id = gh.round_id
WHERE gr.profile_id = 'YOUR_PROFILE_ID_HERE' AND gr.id IS NULL;

-- O4) Check for orphaned notifications (notifications with invalid actors)
SELECT
  'O4) Orphaned Notifications' as check,
  CASE
    WHEN COUNT(*) = 0 THEN '✅ No orphaned notifications'
    ELSE '⛔ ' || COUNT(*) || ' orphaned notifications found!'
  END as status,
  COUNT(*) as orphan_count
FROM notifications n
LEFT JOIN profiles actor ON actor.id = n.actor_id
WHERE n.recipient_id = 'YOUR_PROFILE_ID_HERE' AND actor.id IS NULL;

-- =====================================================
-- END OF VERIFICATION SCRIPT
-- =====================================================

SELECT
  '═══════════════════════════════════════' as divider,
  '✅ VERIFICATION COMPLETE' as status;

SELECT
  'Review all sections above for ✅ (pass) or ⛔ (fail) indicators.' as instructions;

-- =====================================================
-- QUICK HEALTH CHECK (Run this for a fast overview)
-- =====================================================
/*
-- Uncomment and run this for a quick health check:

WITH profile_stats AS (
  SELECT
    (SELECT COUNT(*) FROM posts WHERE profile_id = 'YOUR_PROFILE_ID_HERE') as posts,
    (SELECT COUNT(*) FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE') as media,
    (SELECT COUNT(*) FROM golf_rounds WHERE profile_id = 'YOUR_PROFILE_ID_HERE') as golf_rounds,
    (SELECT COUNT(*) FROM follows WHERE following_id = 'YOUR_PROFILE_ID_HERE') as followers,
    (SELECT COUNT(*) FROM post_likes pl JOIN posts p ON p.id = pl.post_id WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE') as likes_received,
    (SELECT COUNT(*) FROM post_comments c JOIN posts p ON p.id = c.post_id WHERE p.profile_id = 'YOUR_PROFILE_ID_HERE' AND c.profile_id != 'YOUR_PROFILE_ID_HERE') as comments_received,
    (SELECT COUNT(*) FROM notifications WHERE recipient_id = 'YOUR_PROFILE_ID_HERE') as notifications
)
SELECT
  '🎯 QUICK HEALTH CHECK' as title,
  posts || ' posts' as posts_check,
  media || ' media files' as media_check,
  golf_rounds || ' golf rounds' as golf_check,
  followers || ' followers' as followers_check,
  likes_received || ' likes received' as likes_check,
  comments_received || ' comments received' as comments_check,
  notifications || ' notifications' as notifications_check
FROM profile_stats;
*/
