-- ============================================================================
-- 052 — RLS defense-in-depth for profile_access roles (guardian feature)
-- ============================================================================
-- ⚠️ Run AFTER 051. Safe anytime: has_profile_access() returns false for
-- everyone until guardian/viewer rows exist, so these policies are inert
-- no-ops today.
--
-- PRIMARY enforcement is the app layer (requireProfileRole — 72/85 routes
-- use the service-role client, which never consults RLS). This migration is
-- the safety net for the RLS-client routes and direct PostgREST access.
--
-- Design: ADDITIVE supplementary policies (permissive policies OR together)
-- so live policy bodies are never clobbered. Exceptions, rewritten from
-- verbatim-known bodies: posts_select_policy (needs a NARROWING status arm,
-- which additive policies cannot express) and can_view_profile() (from the
-- Phase-0 dump).
--
-- Deliberate exclusions (v1): messaging + notifications stay self-only;
-- NO supervised/viewer WRITE policies anywhere — supervised writes go
-- through the app layer only, which forces status='pending_approval'
-- (an RLS write path would let a supervised user bypass the approval queue
-- via PostgREST).
-- ============================================================================

-- ── Read access for guardian/supervised/viewer ─────────────────────────────
-- Tables keyed directly by profile_id:
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'golf_rounds','season_highlights','performances',
    'athlete_vitals','athlete_achievements','athlete_equipment',
    'workout_sessions','workout_exercises','workout_sets'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_profile_access_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (
         public.has_profile_access(profile_id, ARRAY[''guardian'',''supervised'',''viewer''])
       )',
      t || '_profile_access_select', t
    );
  END LOOP;
END $$;

-- profiles (keyed by id):
DROP POLICY IF EXISTS profiles_profile_access_select ON profiles;
CREATE POLICY profiles_profile_access_select ON profiles
  FOR SELECT USING (
    public.has_profile_access(id, ARRAY['guardian','supervised','viewer'])
  );

-- posts (keyed by profile_id) — read INCLUDING pending (guardians review it):
DROP POLICY IF EXISTS posts_profile_access_select ON posts;
CREATE POLICY posts_profile_access_select ON posts
  FOR SELECT USING (
    public.has_profile_access(profile_id, ARRAY['guardian','supervised','viewer'])
  );

-- Traversal tables (no own profile_id):
DROP POLICY IF EXISTS post_media_profile_access_select ON post_media;
CREATE POLICY post_media_profile_access_select ON post_media
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM posts p
      WHERE p.id = post_media.post_id
        AND public.has_profile_access(p.profile_id, ARRAY['guardian','supervised','viewer'])
    )
  );
DROP POLICY IF EXISTS golf_holes_profile_access_select ON golf_holes;
CREATE POLICY golf_holes_profile_access_select ON golf_holes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM golf_rounds r
      WHERE r.id = golf_holes.round_id
        AND public.has_profile_access(r.profile_id, ARRAY['guardian','supervised','viewer'])
    )
  );

-- ── Guardian WRITE access on content tables ────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'posts','golf_rounds','athlete_vitals','athlete_achievements',
    'athlete_equipment','workout_sessions','workout_exercises','workout_sets'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_guardian_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (
         public.has_profile_access(profile_id, ARRAY[''guardian''])
       ) WITH CHECK (
         public.has_profile_access(profile_id, ARRAY[''guardian''])
       )',
      t || '_guardian_write', t
    );
  END LOOP;
END $$;

-- ── posts_select_policy REWRITE: status arms (narrowing — can't be additive)
-- Base body = optimize-all-rls-policies.sql canon; public/follower arms now
-- require status='published'; owners see everything (guardians via the
-- additive policy above).
DROP POLICY IF EXISTS posts_select_policy ON posts;
CREATE POLICY posts_select_policy ON posts
  FOR SELECT USING (
    posts.profile_id = (select auth.uid())
    OR (
      posts.status = 'published'
      AND (
        posts.visibility = 'public'
        OR EXISTS (
          SELECT 1 FROM follows
          WHERE follows.follower_id = (select auth.uid())
            AND follows.following_id = posts.profile_id
            AND follows.status = 'accepted'
        )
      )
    )
  );

-- ── can_view_profile(): profile_access branch (body from Phase-0 dump) ─────
CREATE OR REPLACE FUNCTION public.can_view_profile(target_profile_id uuid, viewer_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  profile_vis TEXT;
  is_following BOOLEAN;
BEGIN
  SELECT visibility INTO profile_vis
  FROM public.profiles
  WHERE id = target_profile_id;

  -- Own profile
  IF target_profile_id = viewer_id THEN
    RETURN TRUE;
  END IF;

  -- Guardian / supervised / viewer access rows (guardian-profiles feature)
  IF viewer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profile_access
    WHERE profile_id = target_profile_id AND user_id = viewer_id
  ) THEN
    RETURN TRUE;
  END IF;

  -- Public profile
  IF profile_vis = 'public' THEN
    RETURN TRUE;
  END IF;

  -- Private profile - check if following
  SELECT EXISTS (
    SELECT 1 FROM public.follows
    WHERE follower_id = viewer_id
      AND following_id = target_profile_id
      AND status = 'accepted'
  ) INTO is_following;

  RETURN is_following;
END;
$function$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Verification
-- ============================================================================
-- 1. New policies exist (expect 14 rows):
--    SELECT tablename, policyname FROM pg_policies
--    WHERE policyname LIKE '%profile_access_select' OR policyname LIKE '%guardian_write'
--    ORDER BY tablename;
-- 2. posts_select_policy carries the status arm:
--    SELECT qual FROM pg_policies WHERE policyname = 'posts_select_policy';
--    -- expect: contains "status = 'published'"
-- 3. Existing-user regression — as YOUR logged-in account in the app:
--    feed loads, own posts visible, a followed public profile's posts visible.
-- ============================================================================
