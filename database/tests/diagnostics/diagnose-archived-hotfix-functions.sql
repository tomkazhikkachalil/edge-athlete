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
-- A SECOND archived family does the same kind of damage a different way:
--   archive/old-migrations/fix-function-search-paths{,-compatible}.sql
-- pinned search_path = '' onto 47 functions WITHOUT qualifying their bodies,
-- which broke two RPCs outright (see section 4 and migration 082).
--
-- A THIRD detection route, and the cheapest: just CALL every read-only RPC and
-- watch for 42P01 (stale relation) or 42703 (stale column). That sweep found
-- get_golf_scorecard and get_group_post_details — bodies from an older schema
-- generation, repaired in migration 084. Worth repeating; the scratchpad
-- harness is rpc_sweep.mjs. NEVER blanket-call the MUTATING RPCs that way
-- (cleanup_*, mark_*, update_*, create_*) — on production they would alter or
-- delete real data. Those still need the static read in section 3.
--
-- What NO probe can catch: a body that runs fine and returns the WRONG DATA.
-- Section 3 is the only route to those.
--
-- HOW TO USE: run each query, eyeball section 3 in particular, and compare any
-- suspicious body against the migration that is supposed to own it. Section 4a
-- is the one to re-run after ANY future hot-fix.
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

-- ── 4. EMPTY search_path + unqualified references. Empty search_path is
--       correct practice, but ONLY if every reference is schema-qualified;
--       otherwise the function fails at RUNTIME with 42P01.
--
--       *** THIS SECTION HAS ALREADY EARNED ITS KEEP TWICE. ***
--       Aug 12 2026: listed 17 functions; probing found TWO broken live —
--         get_unread_notification_count -> 42P01 relation "notifications"…
--         get_tagged_posts              -> 42P01 relation "post_tags"…
--       (fixed by migration 082). A static scan of the archived SCRIPTS had
--       wrongly declared this class clear: the hazard is the CROSS PRODUCT —
--       a script pins search_path='' onto a body that came from a DIFFERENT
--       migration and was never qualified. Only proconfig+prosrc reveal it.
--
--       Source of the empty pins is its own archived family, separate from
--       the fix-*schema*.sql sweep:
--         archive/old-migrations/fix-function-search-paths.sql
--         archive/old-migrations/fix-function-search-paths-compatible.sql
--       whose header states it "secures all exposed functions by setting
--       search_path = '' (empty)" — 47 of them, no bodies rewritten.
--
--       READ THE proconfig COLUMN, not just the function name:
--         search_path=""       -> AT RISK, probe it
--         search_path=public   -> safe, unqualified names still resolve
--       Remedy is one line, per migration 040's precedent:
--         ALTER FUNCTION public.f(args) SET search_path = 'public';

-- 4a. The full AT-RISK population: every function pinned to an EMPTY path.
--     No heuristic — probe anything here that the app calls. 4b narrows it,
--     but 4b is only a guess; this list is the ground truth.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proconfig::text ~ 'search_path=""'
ORDER BY p.proname;

-- 4b. Of those, the ones whose body appears to reference an unqualified
--     relation. Checks EVERY relation position — the original version only
--     looked at FROM/JOIN, so an unqualified name in an INSERT INTO / UPDATE /
--     DELETE FROM position was just as broken and completely invisible.
--     Still a heuristic: comment prose and constructs like
--     `IS DISTINCT FROM OLD` produce false positives, so confirm by CALLING
--     the function and looking for 42P01 rather than by reading the match.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proconfig::text ~ 'search_path=""'
  AND (
        p.prosrc ~* '\m(FROM|JOIN)\s+(?!public\.|pg_|LATERAL\M|\()[a-z_]'
     OR p.prosrc ~* '\mINSERT\s+INTO\s+(?!public\.|pg_)[a-z_]'
     OR p.prosrc ~* '\mUPDATE\s+(?!public\.|pg_)[a-z_][a-z0-9_]*\s+SET\M'
     OR p.prosrc ~* '\mDELETE\s+FROM\s+(?!public\.|pg_)[a-z_]'
  )
ORDER BY p.proname;

-- ── 5. EXECUTE-GRANT INVENTORY — who can call what ─────────────────────────
--       READ ONLY, and the deliberate answer to the one question probing
--       cannot safely ask. SEVEN of these functions MUTATE:
--         cleanup_old_notifications   (DELETEs rows)
--         mark_all_notifications_read
--         create_notification
--         update_user_handle
--         create_profile_with_owner
--         create_managed_profile
--         grant_guardian_access
--       The only way to test executability by CALLING them is to run them
--       against production. So don't — read the grants instead.
--
--       Migration 040 revoked most server-side RPCs by name, and 085 caught
--       five it missed (search_by_handle, generate_connection_suggestions,
--       get_pending_requests_count, check_handle_availability,
--       calculate_round_stats — all reachable with the PUBLIC ANON KEY).
--       Nothing has ever verified the grants actually took. This does.
--
--       THE RULE 085 EXISTS TO ENFORCE: an app-layer filter is NOT a
--       substitute for an EXECUTE grant. /api/handles/search carefully drops
--       private profiles after calling search_by_handle — and anyone could
--       call that RPC directly with the anon key and skip the route entirely.

-- 5a. Every function anon or authenticated can execute. Each row is a
--     decision: does a browser key genuinely need this?
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_execute,
       p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (has_function_privilege('anon',          p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
ORDER BY p.prosecdef DESC, p.proname;
-- SECURITY DEFINER rows sort first on purpose: those bypass RLS, so a stray
-- grant there is the most dangerous kind.

-- 5b. The mutating set specifically — these should ALL be false/false.
SELECT p.proname AS function_name,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'cleanup_old_notifications','mark_all_notifications_read','create_notification',
    'update_user_handle','create_profile_with_owner','create_managed_profile',
    'grant_guardian_access','calculate_round_stats'
  )
ORDER BY p.proname;
