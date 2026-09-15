-- ============================================================================
-- 208: retire 008's `notification_preferences.tag_notifications_enabled`
--      claim (a NO-OP on production — the column never landed)
-- ============================================================================
-- The reverse schema question (`npm run check:schema`, Sep 16 2026: every
-- table and column the chain OWNS must be LIVE, not only the other way
-- round) found exactly one claim the live database does not carry:
-- 008_tagging_system.sql:168 `ADD COLUMN IF NOT EXISTS
-- tag_notifications_enabled BOOLEAN DEFAULT true`. Live,
-- notification_preferences has `tags_enabled` (the column every reader
-- uses — `grep tag_notifications_enabled src` is empty) and no
-- `tag_notifications_enabled`; the 008 ALTER either never ran or ran on a
-- table that was later re-created by the preferences baseline. Nothing
-- reads it, nothing is lost: this file records the fact in the chain so
-- the claim is retired — `DROP COLUMN IF EXISTS` is a no-op live and the
-- parser (`schema-inventory-core.mjs`) drops the column from the chain's
-- ownership when it sees it.
--
-- Found because of 207: #761 (which SELECTs 207's columns on every event
-- read) was merged before 207 ran and the forward check stayed green — the
-- reverse question is what would have said "207 has not run" by name.
-- ============================================================================

ALTER TABLE notification_preferences DROP COLUMN IF EXISTS tag_notifications_enabled;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 208 APPLIED | 0 | 1
SELECT '208 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = 'tag_notifications_enabled') AS columns_expect_0,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'notification_preferences' AND column_name = 'tags_enabled') AS tags_enabled_expect_1;
