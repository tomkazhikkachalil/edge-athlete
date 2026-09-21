-- ============================================================================
-- Verify migration 225 (deletion-safe attribution FKs; moderation_state
-- nullable — Round 1)
-- ============================================================================
-- READ ONLY. BEFORE 225 the rows read CHECK FAILED; AFTER 225 every row reads
-- OK. The migration ends in ONE result row ("225 APPLIED | 3 | 3 | 1").
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-225-deletion-safe-fks.sql' AS expected, 'verify-225-deletion-safe-fks.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'the three attribution FKs are ON DELETE SET NULL', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint
 WHERE conname IN ('contest_stat_lines_entered_by_fkey', 'contest_media_uploaded_by_fkey', 'contest_media_tags_tagged_by_fkey')
   AND contype = 'f' AND confdeltype = 'n' AND confrelid = 'public.profiles'::regclass

UNION ALL

SELECT 'the three attribution columns are nullable', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'contest_stat_lines' AND column_name = 'entered_by')
     OR (table_name = 'contest_media' AND column_name = 'uploaded_by')
     OR (table_name = 'contest_media_tags' AND column_name = 'tagged_by'))
   AND is_nullable = 'YES'

UNION ALL

SELECT 'no attribution row lost its value (the change is additive)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM (
    SELECT 1 FROM contest_stat_lines WHERE entered_by IS NULL
    UNION ALL SELECT 1 FROM contest_media WHERE uploaded_by IS NULL
    UNION ALL SELECT 1 FROM contest_media_tags WHERE tagged_by IS NULL
  ) x

UNION ALL

SELECT 'profiles.moderation_state is nullable with DEFAULT active', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'moderation_state'
   AND is_nullable = 'YES' AND column_default LIKE '%active%'

UNION ALL

SELECT 'every profile still reads active or a set state (no NULL introduced)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM profiles WHERE moderation_state IS NULL;
