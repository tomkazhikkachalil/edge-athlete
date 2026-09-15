-- ============================================================================
-- Verify migration 208 (008's tag_notifications_enabled claim retired)
-- ============================================================================
-- READ ONLY. Safe to run any time. 208 is a NO-OP on production, so this
-- grid reads OK before and after it — the chain is what changed. The first
-- row names THIS file so a pasted grid can never be mistaken for the
-- migration's result row.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-208-notification-preferences.sql' AS expected, 'verify-208-notification-preferences.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'tag_notifications_enabled absent', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = 'tag_notifications_enabled'

UNION ALL

SELECT 'tags_enabled present (the live preference)', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = 'tags_enabled'

ORDER BY 1;
