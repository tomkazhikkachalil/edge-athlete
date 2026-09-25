-- ============================================================================
-- Verify migration 238 (departed accounts — the profile row outlives its
-- auth user as a name-only tombstone)
-- ============================================================================
-- READ ONLY, and runnable BEFORE 238 (the column is read through to_jsonb, so
-- a missing column reads NULL instead of failing): before 238 the structural
-- rows read CHECK FAILED; after it every row reads OK. The migration ends in
-- ONE result row ("238 APPLIED | 1 | 0 | 1 | 1 | 1 | 238").
--
-- The ORPHAN row is the standing check: a profile with no auth user that is
-- NOT a tombstone is a delete from the Supabase dashboard (238 dropped the
-- cascade that used to clean it up) — run the deletion engine on it through
-- the admin guardian-support door, never leave it (docs/RUNBOOK_BACKUP.md).
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-238-departed-profiles.sql' AS expected, 'verify-238-departed-profiles.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'profiles.departed_at exists (timestamptz, nullable)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'departed_at'
   AND data_type = 'timestamp with time zone' AND is_nullable = 'YES'

UNION ALL

SELECT 'the partial index on departed_at exists', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_profiles_departed'

UNION ALL

SELECT 'profiles no longer cascades from auth.users (profiles_id_fkey gone)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conname = 'profiles_id_fkey' AND conrelid = 'public.profiles'::regclass

UNION ALL

SELECT 'athlete_performances.profile_id is ON DELETE SET NULL', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint
 WHERE conname = 'athlete_performances_profile_id_fkey' AND contype = 'f' AND confdeltype = 'n'
   AND confrelid = 'public.profiles'::regclass

UNION ALL

SELECT 'athlete_performances.profile_id is nullable', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'athlete_performances' AND column_name = 'profile_id' AND is_nullable = 'YES'

UNION ALL

SELECT 'the tombstone read policy exists', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_departed_select'

UNION ALL

SELECT 'search_people filters departed_at', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'search_people' AND p.prosrc LIKE '%departed_at IS NULL%'

UNION ALL

SELECT 'the athlete search document watches departed_at (SECURITY DEFINER kept)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'search_doc_sync_athlete' AND p.prosecdef
   AND p.prosrc LIKE '%NEW.departed_at IS NOT NULL%'

UNION ALL

SELECT 'the no-bell-to-a-departed-recipient trigger exists', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgname = 'notifications_skip_departed' AND NOT tgisinternal

UNION ALL

SELECT 'ORPHANS: profiles with no auth user that are not tombstones', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM profiles p
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.id)
   AND (to_jsonb(p) ->> 'departed_at') IS NULL

UNION ALL

SELECT 'every tombstone is stripped (departed email, no handle, private)', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM profiles p
 WHERE (to_jsonb(p) ->> 'departed_at') IS NOT NULL
   AND (p.email NOT LIKE '%@departed.invalid' OR p.handle IS NOT NULL OR p.visibility <> 'private'
        OR p.avatar_url IS NOT NULL OR p.dob IS NOT NULL OR p.deletion_requested_at IS NOT NULL);
