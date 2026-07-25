-- ============================================================================
-- Migration 036 — Restore the generic updated_at trigger function
-- ============================================================================
-- ROOT CAUSE: an old "fix" migration (archive/old-migrations/
-- fix-utility-functions-schema.sql) misread public.handle_updated_at() —
-- the generic "handle the updated_at column" trigger from 001, attached to
-- profiles, clubs, and group_posts — as handle-change tracking, and
-- redefined its body to `NEW.handle_updated_at := NOW()`. Only profiles has
-- that column, so EVERY UPDATE on any other table wired to this trigger
-- fails with 42703 ("record new has no field handle_updated_at").
--
-- Found July 25 via the two-phone test: group_posts updates (the post_id
-- backlink at round creation, and ALL round status transitions
-- pending→active→completed) were hard-failing on this.
--
-- Handle-change tracking never needed the trigger: update_user_handle()
-- (006) sets handle_updated_at explicitly. Restoring the original body is
-- purely corrective.
--
-- Known collateral while broken (accepting, data not repairable): profiles'
-- handle_updated_at was stamped on every profile edit (inflating the 7-day
-- handle-change rate limit), and updated_at was NOT maintained on affected
-- tables.
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ⚠️ No deploy needed — takes effect immediately. Idempotent.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT prosrc FROM pg_proc WHERE proname = 'handle_updated_at';
--   → body sets NEW.updated_at (NOT NEW.handle_updated_at)
-- Functional: the diagnostic script's step 6 (group_posts UPDATE) passes.
