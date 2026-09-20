-- ============================================================================
-- Verify migration 223 (profiles.moderation_state · hidden posts and comments
-- · a frozen conversation · user_mutes · moderation_notice — Support &
-- Reporting, Spec 2)
-- ============================================================================
-- READ ONLY. Safe to run any time — BEFORE 223 the rows read CHECK FAILED
-- (every check counts catalog rows); AFTER 223 every row reads OK. The
-- migration ends in ONE result row ("223 APPLIED | 1 | 1 | 1 | 1 | 1 | 1");
-- the first row here names THIS file.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-223-moderation.sql' AS expected, 'verify-223-moderation.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'profiles.moderation_state (text, NOT NULL, default active)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'moderation_state'
   AND is_nullable = 'NO' AND column_default LIKE '%active%'

UNION ALL

SELECT 'profiles_moderation_state_check admits the four states', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'profiles_moderation_state_check' AND conrelid = 'public.profiles'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%limited%' AND pg_get_constraintdef(oid) LIKE '%suspended%' AND pg_get_constraintdef(oid) LIKE '%banned%'

UNION ALL

SELECT 'profiles.moderation_until + moderation_ticket_id', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name IN ('moderation_until', 'moderation_ticket_id')

UNION ALL

SELECT 'every existing profile is active (the default did not touch a row)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM profiles WHERE moderation_state <> 'active'

UNION ALL

SELECT 'posts_status_check admits hidden (and still changes_requested)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'posts_status_check' AND conrelid = 'public.posts'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%hidden%' AND pg_get_constraintdef(oid) LIKE '%changes_requested%'

UNION ALL

SELECT 'post_comments_status_check admits hidden', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'post_comments_status_check' AND conrelid = 'public.post_comments'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%hidden%'

UNION ALL

SELECT 'posts + post_comments: hidden_at + hidden_ticket_id', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name IN ('posts', 'post_comments') AND column_name IN ('hidden_at', 'hidden_ticket_id')

UNION ALL

SELECT 'conversations.frozen_at + frozen_ticket_id', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name IN ('frozen_at', 'frozen_ticket_id')

UNION ALL

SELECT 'user_mutes table exists with the pair UNIQUE and the not-self CHECK', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.user_mutes'::regclass AND conname IN ('user_mutes_pair_key', 'user_mutes_not_self')

UNION ALL

SELECT 'posture A: user_mutes RLS on, zero policies', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relname = 'user_mutes' AND c.relrowsecurity
   AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = 'user_mutes')

UNION ALL

SELECT 'posture A: anon + authenticated hold no privilege on user_mutes', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'user_mutes' AND grantee IN ('anon', 'authenticated')

UNION ALL

SELECT 'notifications_type_check admits moderation_notice (and still ticket_critical)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'notifications_type_check' AND conrelid = 'public.notifications'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%moderation_notice%' AND pg_get_constraintdef(oid) LIKE '%ticket_critical%';
