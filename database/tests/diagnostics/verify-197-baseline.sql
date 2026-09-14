-- ============================================================================
-- Verify migration 197 (functions baseline) — every recorded body is live
-- ============================================================================
-- READ ONLY. Safe to run any time. Expected md5s are the Sep 14 2026
-- catalog's (database/provenance/dumps/2026-09-14-catalog.json); 197 is a no-op on
-- production, so the grid reads the same before and after. A later migration
-- that changes one of these functions changes its md5 here on purpose.
-- Every row should read OK.
-- ============================================================================

SELECT 'calculate_round_stats(uuid): body' AS check_name, '83b88b678b299fd21f978a5caa350da0' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '83b88b678b299fd21f978a5caa350da0' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'calculate_round_stats' AND oidvectortypes(proargtypes) = 'uuid'
UNION ALL

SELECT 'check_handle_availability(text, uuid): body' AS check_name, '274a605c593408e4bbaa45b663ed1514' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '274a605c593408e4bbaa45b663ed1514' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'check_handle_availability' AND oidvectortypes(proargtypes) = 'text, uuid'
UNION ALL

SELECT 'cleanup_old_notifications(): body' AS check_name, 'fea721d22374be850a673db5fd77a5a5' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'fea721d22374be850a673db5fd77a5a5' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'cleanup_old_notifications' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'create_notification(uuid, text, uuid, text, text, text, uuid, uuid, uuid, jsonb): body' AS check_name, '2c8cdd7b391261b170eac4605a145c85' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '2c8cdd7b391261b170eac4605a145c85' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'create_notification' AND oidvectortypes(proargtypes) = 'uuid, text, uuid, text, text, text, uuid, uuid, uuid, jsonb'
UNION ALL

SELECT 'decrement_post_save_count(): body' AS check_name, '0ddf4c7af0b785155db701240f7effeb' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '0ddf4c7af0b785155db701240f7effeb' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'decrement_post_save_count' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'generate_connection_suggestions(uuid, integer): body' AS check_name, 'bd6e95085aa62c2414ba920d45c6b748' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'bd6e95085aa62c2414ba920d45c6b748' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'generate_connection_suggestions' AND oidvectortypes(proargtypes) = 'uuid, integer'
UNION ALL

SELECT 'get_pending_requests_count(uuid): body' AS check_name, '372d1116dae84878a526816d34bc1440' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '372d1116dae84878a526816d34bc1440' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'get_pending_requests_count' AND oidvectortypes(proargtypes) = 'uuid'
UNION ALL

SELECT 'handle_new_user(): body' AS check_name, '75c33bab4aa62349e1d043640df1623e' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '75c33bab4aa62349e1d043640df1623e' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'handle_new_user' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'increment_post_save_count(): body' AS check_name, 'c6efc4003f486b340df16b5b2539cc02' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'c6efc4003f486b340df16b5b2539cc02' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'increment_post_save_count' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'mark_all_notifications_read(): body' AS check_name, 'a459f630ffeaba6de7a6e43f6dc13d41' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'a459f630ffeaba6de7a6e43f6dc13d41' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'mark_all_notifications_read' AND oidvectortypes(proargtypes) = ''
UNION ALL

SELECT 'mark_all_notifications_read(uuid): body' AS check_name, '771b23444279d4aecec0511f86dd600f' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '771b23444279d4aecec0511f86dd600f' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'mark_all_notifications_read' AND oidvectortypes(proargtypes) = 'uuid'
UNION ALL

SELECT 'search_by_handle(text, integer): body' AS check_name, 'f360bb3eed139082f1e85aab1f3f9efa' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = 'f360bb3eed139082f1e85aab1f3f9efa' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'search_by_handle' AND oidvectortypes(proargtypes) = 'text, integer'
UNION ALL

SELECT 'search_profiles(text, integer): body' AS check_name, '789f8442ff0220d33b923051ba8d8064' AS expected, md5(prosrc) AS actual,
       CASE WHEN md5(prosrc) = '789f8442ff0220d33b923051ba8d8064' THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'search_profiles' AND oidvectortypes(proargtypes) = 'text, integer'
UNION ALL

SELECT 'is_valid_handle(text): search_path', 'search_path=""', COALESCE(array_to_string(proconfig, ';'), '-'),
       CASE WHEN 'search_path=""' = ANY (proconfig) THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'is_valid_handle' AND oidvectortypes(proargtypes) = 'text'
UNION ALL

SELECT 'anon cannot execute the service-only ones', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc WHERE pronamespace = 'public'::regnamespace
   AND (proname, oidvectortypes(proargtypes)) IN (('calculate_round_stats', 'uuid'), ('check_handle_availability', 'text, uuid'), ('cleanup_old_notifications', ''), ('create_notification', 'uuid, text, uuid, text, text, text, uuid, uuid, uuid, jsonb'), ('generate_connection_suggestions', 'uuid, integer'), ('get_pending_requests_count', 'uuid'), ('handle_new_user', ''), ('mark_all_notifications_read', ''), ('mark_all_notifications_read', 'uuid'), ('search_by_handle', 'text, integer'), ('search_profiles', 'text, integer'))
   AND has_function_privilege('anon', oid, 'EXECUTE')
UNION ALL

SELECT 'public non-extension functions', '107', count(*)::text,
       CASE WHEN count(*) = 107 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prokind IN ('f', 'p')
   AND NOT EXISTS (SELECT 1 FROM pg_depend x WHERE x.classid = 'pg_proc'::regclass AND x.objid = p.oid AND x.deptype = 'e')

ORDER BY 1;
