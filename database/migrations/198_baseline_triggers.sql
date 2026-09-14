-- ============================================================================
-- 198: BASELINE — the one live trigger the chain never named, recorded
--      (hygiene sweep, H2 — Sep 16 2026)
-- ============================================================================
-- The first run of the TRIGGER and GRANT facets (migration 195's catalog,
-- database/provenance/dumps/2026-09-14-catalog.json) found 100 of the 101
-- live triggers claimed by the chain with zero drift and zero stale claims,
-- and every one of the 107 functions' EXECUTE grantees equal to the set the
-- chain simulates — nothing to record on the grant side. One trigger has no
-- numbered owner: trigger_group_posts_updated_at ON group_posts, created by
-- database/archive/loose-legacy/add-shared-golf-rounds.sql. This file is the
-- chain's first statement of it, verbatim from pg_get_triggerdef — the 190
-- idiom (DROP IF EXISTS + CREATE, the same definition = a functional
-- no-op). Drops nothing else, changes nothing, re-runnable.
--
-- Recorded as found — a later migration may decide: group_posts now carries
-- TWO BEFORE UPDATE triggers that set updated_at — this archived one
-- (handle_updated_at(), timezone('utc', now())) and the chain's
-- trigger_update_group_post_timestamp (update_group_post_timestamp()).
-- Postgres fires same-event triggers in name order, so the chain's fires
-- second and its value wins; the archived one costs one assignment per
-- update and changes nothing. Migration 199 (the cleanup) drops it.
-- ============================================================================

DROP TRIGGER IF EXISTS trigger_group_posts_updated_at ON public.group_posts;
CREATE TRIGGER trigger_group_posts_updated_at BEFORE UPDATE ON public.group_posts FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'group_posts: trigger_group_posts_updated_at' AS check_name, 'a724655f02194ad758c31ae94e4184bd' AS expected,
       COALESCE((SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
                  WHERE t.tgrelid = 'public.group_posts'::regclass AND t.tgname = 'trigger_group_posts_updated_at'), '-') AS actual,
       CASE WHEN (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
                   WHERE t.tgrelid = 'public.group_posts'::regclass AND t.tgname = 'trigger_group_posts_updated_at') = 'a724655f02194ad758c31ae94e4184bd'
            THEN 'OK' ELSE 'CHECK FAILED' END AS status

UNION ALL

SELECT 'group_posts: triggers', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.group_posts'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'public non-internal triggers', '101', count(*)::text,
       CASE WHEN count(*) = 101 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal

ORDER BY 1;
