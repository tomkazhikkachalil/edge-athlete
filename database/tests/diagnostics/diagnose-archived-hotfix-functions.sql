-- ============================================================================
-- Diagnostic — which live functions still carry an ARCHIVED hot-fix body?
-- ============================================================================
-- READ ONLY. Safe to run any time. Nothing here modifies the database.
--
-- Why this exists
-- ---------------
-- database/archive/old-migrations/fix-*schema*.sql redefined 43 functions in
-- one sweep, several of them written as if attached to the WRONG TABLE. That
-- single mistake has now caused FOUR production incidents:
--
--   025  notify_profile_tagged()        — tagging people failed outright
--   036  handle_updated_at()            — every UPDATE on profiles/clubs/
--                                         group_posts failed (two-phone test)
--   037  update_group_post_timestamp()  — round status transitions failed
--   081  update_post_tags_updated_at()  — untagging failed / marker lost
--
-- The Aug 12 2026 audit closed the TRIGGER class completely: all four
-- field/table mismatches are fixed, and every table wired to one of these
-- functions was probed live (profiles, events, group_posts,
-- group_post_participants, post_tags, conversations, follows) — all healthy.
--
-- What that audit could NOT check
-- -------------------------------
-- 24 of the 43 archived functions are RPC-only (no NEW/OLD, no trigger). An
-- archived body can still be live there and simply return WRONG RESULTS
-- without ever raising an error, so no amount of black-box probing finds it.
-- That needs prosrc, which is only reachable from SQL. Hence this file.
--
-- HOW TO USE: run each query, eyeball section 3 in particular, and compare any
-- suspicious body against the migration that is supposed to own it.
-- ============================================================================

-- ── 1. Every trigger in the database and the function behind it ─────────────
-- Sanity list. Anything here whose function name appears in the archived
-- scripts is worth a look in section 3.
SELECT
  c.relname                AS table_name,
  t.tgname                 AS trigger_name,
  p.proname                AS function_name,
  pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_proc  p     ON p.oid = t.tgfoid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'public'
ORDER BY c.relname, t.tgname;

-- ── 2. THE KILLER QUERY — trigger functions referencing a column their own
--       table does not have. This is the exact shape of all four incidents.
--       Any row returned here is a live bug waiting to fire.
WITH trig AS (
  SELECT c.relname AS tbl, p.proname AS fn, p.prosrc AS src
  FROM pg_trigger t
  JOIN pg_class c     ON c.oid = t.tgrelid
  JOIN pg_proc  p     ON p.oid = t.tgfoid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND n.nspname = 'public'
),
refs AS (
  SELECT DISTINCT
    trig.tbl,
    trig.fn,
    lower((regexp_matches(trig.src, '(?:NEW|OLD)\.([a-zA-Z0-9_]+)', 'gi'))[1]) AS field
  FROM trig
)
SELECT refs.tbl AS table_name, refs.fn AS function_name, refs.field AS missing_field
FROM refs
WHERE NOT EXISTS (
  SELECT 1 FROM information_schema.columns col
  WHERE col.table_schema = 'public'
    AND col.table_name   = refs.tbl
    AND col.column_name  = refs.field
)
ORDER BY refs.tbl, refs.fn, refs.field;
-- Expected after 025/036/037/081: ZERO ROWS.

-- ── 3. Live bodies of every function the archived sweep touched ─────────────
-- The RPC-only ones cannot be verified by probing — read these and compare
-- against the migration that owns each. Particular attention to the profile
-- media RPCs, which have their own incident history (migration 068).
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosrc AS body
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'auto_update_display_name','calculate_golf_participant_totals',
    'calculate_round_stats','can_view_profile','check_handle_availability',
    'cleanup_old_notifications','create_notification',
    'decrement_comment_likes_count','decrement_post_save_count',
    'generate_connection_suggestions','get_golf_scorecard',
    'get_group_post_details','get_pending_requests_count',
    'get_profile_all_media','get_profile_media_counts',
    'get_profile_stats_media','get_profile_tagged_media',
    'get_unread_notification_count','handle_new_user','handle_updated_at',
    'increment_comment_likes_count','increment_post_save_count',
    'notify_comment_like','notify_follow_accepted','notify_follow_request',
    'notify_new_follower','notify_post_comment','notify_post_like',
    'notify_profile_tagged','search_by_handle','sync_privacy_settings',
    'update_follows_updated_at','update_group_post_timestamp',
    'update_post_comments_count','update_post_likes_count',
    'update_post_tags_updated_at','update_updated_at_column',
    'update_user_handle'
  )
ORDER BY p.proname;

-- ── 4. Functions with an EMPTY search_path that reference an unqualified
--       table. Empty search_path is correct practice, but only if every
--       reference is schema-qualified; otherwise it fails at RUNTIME.
--       The static audit found none in the archived scripts (they qualify
--       their tables), but this checks what is actually installed.
SELECT p.proname AS function_name, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proconfig::text LIKE '%search_path=%'
  AND p.prosrc ~* '\m(FROM|JOIN)\s+(?!public\.|pg_)[a-z_]'
ORDER BY p.proname;
