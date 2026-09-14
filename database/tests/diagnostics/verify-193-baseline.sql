-- ============================================================================
-- Verify migration 193 (profiles measurables) — the live shape is recorded
-- ============================================================================
-- READ ONLY. Safe to run any time. Expected values are the Sep 14 2026 dump's
-- (database/provenance/dumps/2026-09-14-live-dump.csv); 193 is a no-op on
-- production, so the grid reads the same before and after. Every row OK.
-- ============================================================================

SELECT 'profiles: the 23 columns' AS check_name, '23' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 23 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles'
   AND column_name IN ('username', 'full_name', 'bio', 'height_cm', 'weight_kg', 'dob', 'class_year', 'social_twitter', 'social_instagram', 'social_facebook', 'avatar_url', 'weight_unit', 'weight_display', 'display_name', 'sport', 'school', 'coach', 'graduation_year', 'gpa', 'sat_score', 'act_score', 'visibility', 'search_vector')

UNION ALL

SELECT 'profiles: columns', '66', count(*)::text,
       CASE WHEN count(*) = 66 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'

UNION ALL

SELECT 'profiles: the three constraints', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass
   AND conname IN ('profiles_username_key', 'profiles_visibility_check', 'check_display_name_not_empty')

UNION ALL

SELECT 'profiles: idx_profiles_visibility', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_profiles_visibility'

UNION ALL

SELECT 'profiles: name triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass
   AND tgname IN ('auto_split_full_name', 'trigger_auto_update_display_name')

UNION ALL

SELECT 'profiles: triggers', '7', count(*)::text,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal

ORDER BY 1;
