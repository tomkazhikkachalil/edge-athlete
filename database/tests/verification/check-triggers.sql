-- CHECK FOR DUPLICATE OR MISCONFIGURED TRIGGERS

-- 1. Check all triggers on post_likes table
SELECT
  'TRIGGERS ON post_likes' as section,
  tgname as trigger_name,
  tgenabled as enabled,
  tgtype as trigger_type,
  pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger
WHERE tgrelid = 'post_likes'::regclass
  AND tgname NOT LIKE 'pg_%'; -- Exclude system triggers

-- 2. Check if trigger function is incrementing correctly
SELECT
  'TRIGGER FUNCTION SOURCE' as section,
  proname as function_name,
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname = 'update_post_likes_count';

-- 3. Test the current state
SELECT
  'CURRENT STATE TEST' as section,
  p.id as post_id,
  p.likes_count as stored_count,
  COUNT(pl.id) as actual_likes
FROM posts p
LEFT JOIN post_likes pl ON pl.post_id = p.id
GROUP BY p.id, p.likes_count
ORDER BY p.created_at DESC
LIMIT 5;

-- 4. Check for duplicate trigger definitions
SELECT
  'DUPLICATE TRIGGER CHECK' as section,
  COUNT(*) as trigger_count,
  tgname as trigger_name
FROM pg_trigger
WHERE tgrelid = 'post_likes'::regclass
  AND tgname NOT LIKE 'pg_%'
GROUP BY tgname
HAVING COUNT(*) > 1;
