-- ============================================================================
-- Migration 035 — Fix infinite RLS recursion on group rounds (42P17)
-- ============================================================================
-- ROOT CAUSE (found by the first-ever real shared-round creation attempt,
-- July 25): group_posts_select_policy EXISTS-checks group_post_participants,
-- whose own policies EXISTS-check group_posts AND group_post_participants
-- itself. Evaluating any of them recurses forever → Postgres aborts with
-- "infinite recursion detected in policy" (42P17). POST /api/group-posts
-- then rolls back atomically, so shared-round creation has NEVER succeeded
-- against live RLS — it only ever appeared to work through the service-role
-- (RLS-bypassing) read paths, and user-scoped reads survived only while the
-- tables were empty (zero rows → policies never evaluated).
--
-- FIX (standard Supabase pattern): SECURITY DEFINER helper functions perform
-- the membership lookups OUTSIDE RLS, so no policy ever triggers another.
-- Semantics are preserved exactly:
--   • group_posts visible to creator, public, or participants
--   • participant rows visible to yourself, the round creator, or co-participants
--   • participants writable by the round creator or organizers (+ own row update)
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ⚠️ No deploy needed — data/policy-only. Fixes prod the moment it runs.
-- Idempotent (CREATE OR REPLACE + DROP IF EXISTS).
-- ============================================================================

-- ── Helper functions (SECURITY DEFINER = read tables without RLS) ───────────
-- Schema-qualified + empty search_path per this repo's function conventions.

CREATE OR REPLACE FUNCTION public.is_group_post_creator(gp_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_posts
    WHERE id = gp_id AND creator_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_post_participant(gp_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_post_participants
    WHERE group_post_id = gp_id AND profile_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_group_post_organizer(gp_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.group_post_participants
    WHERE group_post_id = gp_id AND profile_id = auth.uid()
      AND role IN ('creator', 'organizer')
  );
$$;

-- Locked down: only usable via RLS policy evaluation by API roles
REVOKE ALL ON FUNCTION public.is_group_post_creator(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_group_post_participant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_group_post_organizer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_group_post_creator(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_group_post_participant(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_group_post_organizer(uuid) TO authenticated, anon;

-- ── group_posts: only the SELECT policy participated in the cycle ───────────

DROP POLICY IF EXISTS group_posts_select_policy ON group_posts;
CREATE POLICY group_posts_select_policy ON group_posts
FOR SELECT USING (
  creator_id = (select auth.uid()) OR
  visibility = 'public' OR
  public.is_group_post_participant(id)
);

-- ── group_post_participants: all four policies rewritten cycle-free ─────────

DROP POLICY IF EXISTS participants_select_policy ON group_post_participants;
CREATE POLICY participants_select_policy ON group_post_participants
FOR SELECT USING (
  profile_id = (select auth.uid()) OR
  public.is_group_post_creator(group_post_id) OR
  public.is_group_post_participant(group_post_id)
);

DROP POLICY IF EXISTS participants_insert_policy ON group_post_participants;
CREATE POLICY participants_insert_policy ON group_post_participants
FOR INSERT WITH CHECK (
  public.is_group_post_creator(group_post_id) OR
  public.is_group_post_organizer(group_post_id)
);

DROP POLICY IF EXISTS participants_update_policy ON group_post_participants;
CREATE POLICY participants_update_policy ON group_post_participants
FOR UPDATE USING (
  profile_id = (select auth.uid()) OR
  public.is_group_post_creator(group_post_id) OR
  public.is_group_post_organizer(group_post_id)
);

DROP POLICY IF EXISTS participants_delete_policy ON group_post_participants;
CREATE POLICY participants_delete_policy ON group_post_participants
FOR DELETE USING (
  public.is_group_post_creator(group_post_id) OR
  public.is_group_post_organizer(group_post_id)
);

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT proname FROM pg_proc WHERE proname LIKE 'is_group_post%';
--   → 3 rows
-- SELECT policyname FROM pg_policies
--   WHERE tablename IN ('group_posts','group_post_participants');
--   → the 8 policies, recreated
-- Functional: creating a shared round from the app now succeeds (the
-- diagnostic script / Phase 1 of the two-phone test).
