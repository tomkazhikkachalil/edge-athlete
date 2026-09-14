-- ============================================================================
-- 196: BASELINE — every live RLS policy the chain never named, recorded
--      (provenance round, PR C — Sep 15 2026)
-- ============================================================================
-- The first live run of the policy facet (migration 195's catalog,
-- database/provenance/dumps/2026-09-14-catalog.json) found 56 live policies no
-- numbered file creates and 29 policies the chain still claims that are
-- NOT live — with zero disagreements on command / roles / permissiveness
-- where both sides name a policy. This file closes both gaps, exactly as 190
-- did for tables: the LIVE shape, bodies VERBATIM as pg_policies prints
-- them (USING / WITH CHECK from pg_get_expr — never a rewrite), behind the
-- pg_policies guard; the stale claims as DROP POLICY IF EXISTS, the same
-- record-the-drop move 192 made for the holes CHECK. A NO-OP on production
-- (every CREATE is skipped by its guard, every DROP finds nothing),
-- re-runnable, and the check grid reads the same before and after.
--
-- Where the live names came from (archived scripts, never numbered):
--   * the `<table>_<verb>_policy` family on profiles, golf_rounds,
--     golf_holes, notifications, notification_preferences, saved_posts —
--     database/archive/loose-legacy/optimize-all-rls-policies.sql and
--     fix-all-rls-issues-comprehensive.sql (+ old-migrations/
--     fix-rls-initplan-performance*.sql), which REPLACED 001 / 002 / 003 /
--     007's prose-named policies ("Users can view their own profile" …) —
--     those are the 29 stale claims dropped below;
--   * post_tags_* — archive/loose-legacy/fix-post-tags-final.sql (replacing
--     008's six);
--   * sport_settings_*, group_post_media_*, golf_hole_scores_*,
--     golf_participant_scores_*, golf_scorecard_data_* —
--     archive/loose-legacy/final-rls-fix-all-remaining-tables.sql;
--     participant_scores_* / scorecard_* — archive/loose-legacy/
--     add-shared-golf-rounds.sql;
--   * <table>_profile_access_select and <table>_guardian_write on
--     athlete_achievements, athlete_vitals, workout_sessions,
--     workout_exercises, workout_sets, golf_rounds — migration 052's
--     EXECUTE format() loops (052:28–40, 78–90): the names never appear
--     literally anywhere until now.
--
-- Recorded as found — a baseline never "improves" live behaviour; a later
-- migration may:
--   * golf_scorecard_data carries THREE permissive policy sets (golf_data_*,
--     golf_scorecard_data_*, scorecard_*), golf_participant_scores three
--     (golf_participant_scores_*, golf_scores_*, participant_scores_*),
--     golf_hole_scores two (golf_hole_scores_*, hole_scores_*) — successive
--     archived scripts each added a set and dropped none. Permissive
--     policies OR together, so the widest one governs; the duplicates cost
--     a predicate evaluation per row. One later migration should keep the
--     chain-owned set (063's) and drop the rest.
--   * Every live policy is PERMISSIVE and roles={public}; 001's lone
--     `TO authenticated` policy was dropped by 117.
--   * 040 dropped notifications_insert_policy and 063 dropped
--     golf_participant_scores_select_policy / golf_hole_scores_select_policy
--     — all three are absent live, consistent.
--   * The three storage.objects drops in 040 are out of scope (a
--     Supabase-managed schema; the chain never claims a policy there).
--
-- Proof: `npm run check:schema --facet policies` against the saved catalog
-- with this file in the chain → OK; the real-chain test pins that 001's
-- profile claim is now DROPPED and 052's loop products are literal.
-- ============================================================================

-- ── athlete_achievements — live: 6 policies · recorded here: 2 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_achievements' AND policyname = 'athlete_achievements_guardian_write') THEN
    CREATE POLICY "athlete_achievements_guardian_write" ON public.athlete_achievements FOR ALL
      USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
      WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_achievements' AND policyname = 'athlete_achievements_profile_access_select') THEN
    CREATE POLICY "athlete_achievements_profile_access_select" ON public.athlete_achievements FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
END $$;

-- ── athlete_vitals — live: 4 policies · recorded here: 2 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_vitals' AND policyname = 'athlete_vitals_guardian_write') THEN
    CREATE POLICY "athlete_vitals_guardian_write" ON public.athlete_vitals FOR ALL
      USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
      WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_vitals' AND policyname = 'athlete_vitals_profile_access_select') THEN
    CREATE POLICY "athlete_vitals_profile_access_select" ON public.athlete_vitals FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
END $$;

-- ── golf_hole_scores — live: 7 policies · recorded here: 3 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'golf_hole_scores_delete_policy') THEN
    CREATE POLICY "golf_hole_scores_delete_policy" ON public.golf_hole_scores FOR DELETE
      USING (EXISTS ( SELECT 1
         FROM ((golf_participant_scores gps
           JOIN group_post_participants gpp ON ((gps.participant_id = gpp.id)))
           JOIN group_posts gp ON ((gpp.group_post_id = gp.id)))
        WHERE ((gps.id = golf_hole_scores.golf_participant_id) AND ((gpp.profile_id = ( SELECT auth.uid() AS uid)) OR (gp.creator_id = ( SELECT auth.uid() AS uid))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'golf_hole_scores_insert_policy') THEN
    CREATE POLICY "golf_hole_scores_insert_policy" ON public.golf_hole_scores FOR INSERT
      WITH CHECK (EXISTS ( SELECT 1
         FROM ((golf_participant_scores gps
           JOIN group_post_participants gpp ON ((gps.participant_id = gpp.id)))
           JOIN group_posts gp ON ((gpp.group_post_id = gp.id)))
        WHERE ((gps.id = golf_hole_scores.golf_participant_id) AND ((gpp.profile_id = ( SELECT auth.uid() AS uid)) OR (gp.creator_id = ( SELECT auth.uid() AS uid))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores' AND policyname = 'golf_hole_scores_update_policy') THEN
    CREATE POLICY "golf_hole_scores_update_policy" ON public.golf_hole_scores FOR UPDATE
      USING (EXISTS ( SELECT 1
         FROM (golf_participant_scores gps
           JOIN group_post_participants gpp ON ((gps.participant_id = gpp.id)))
        WHERE ((gps.id = golf_hole_scores.golf_participant_id) AND (gpp.profile_id = ( SELECT auth.uid() AS uid)))));
  END IF;
END $$;

-- ── golf_holes — live: 5 policies · recorded here: 4 · stale claims dropped: 5
DROP POLICY IF EXISTS "Users can view holes for their rounds" ON public.golf_holes; -- 002:87's claim, gone live
DROP POLICY IF EXISTS "Users can insert holes for their rounds" ON public.golf_holes; -- 002:97's claim, gone live
DROP POLICY IF EXISTS "Users can update holes for their rounds" ON public.golf_holes; -- 002:107's claim, gone live
DROP POLICY IF EXISTS "Users can delete holes for their rounds" ON public.golf_holes; -- 002:117's claim, gone live
DROP POLICY IF EXISTS "Users can view holes through posts" ON public.golf_holes; -- 002:196's claim, gone live
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_holes' AND policyname = 'golf_holes_delete_policy') THEN
    CREATE POLICY "golf_holes_delete_policy" ON public.golf_holes FOR DELETE
      USING (EXISTS ( SELECT 1
         FROM golf_rounds
        WHERE ((golf_rounds.id = golf_holes.round_id) AND (golf_rounds.profile_id = ( SELECT auth.uid() AS uid)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_holes' AND policyname = 'golf_holes_insert_policy') THEN
    CREATE POLICY "golf_holes_insert_policy" ON public.golf_holes FOR INSERT
      WITH CHECK (EXISTS ( SELECT 1
         FROM golf_rounds
        WHERE ((golf_rounds.id = golf_holes.round_id) AND (golf_rounds.profile_id = ( SELECT auth.uid() AS uid)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_holes' AND policyname = 'golf_holes_select_policy') THEN
    CREATE POLICY "golf_holes_select_policy" ON public.golf_holes FOR SELECT
      USING (EXISTS ( SELECT 1
         FROM golf_rounds
        WHERE ((golf_rounds.id = golf_holes.round_id) AND ((golf_rounds.profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
                 FROM profiles
                WHERE ((profiles.id = golf_rounds.profile_id) AND ((profiles.visibility = 'public'::text) OR (EXISTS ( SELECT 1
                         FROM follows
                        WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = golf_rounds.profile_id) AND (follows.status = 'accepted'::text))))))))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_holes' AND policyname = 'golf_holes_update_policy') THEN
    CREATE POLICY "golf_holes_update_policy" ON public.golf_holes FOR UPDATE
      USING (EXISTS ( SELECT 1
         FROM golf_rounds
        WHERE ((golf_rounds.id = golf_holes.round_id) AND (golf_rounds.profile_id = ( SELECT auth.uid() AS uid)))));
  END IF;
END $$;

-- ── golf_participant_scores — live: 8 policies · recorded here: 5 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores' AND policyname = 'golf_participant_scores_insert_policy') THEN
    CREATE POLICY "golf_participant_scores_insert_policy" ON public.golf_participant_scores FOR INSERT
      WITH CHECK ((( SELECT auth.uid() AS uid) = entered_by) AND (EXISTS ( SELECT 1
         FROM (group_post_participants gpp
           JOIN group_posts gp ON ((gpp.group_post_id = gp.id)))
        WHERE ((gpp.id = golf_participant_scores.participant_id) AND ((gpp.profile_id = ( SELECT auth.uid() AS uid)) OR (gp.creator_id = ( SELECT auth.uid() AS uid)))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores' AND policyname = 'golf_participant_scores_update_policy') THEN
    CREATE POLICY "golf_participant_scores_update_policy" ON public.golf_participant_scores FOR UPDATE
      USING (EXISTS ( SELECT 1
         FROM group_post_participants
        WHERE ((group_post_participants.id = golf_participant_scores.participant_id) AND (group_post_participants.profile_id = ( SELECT auth.uid() AS uid)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores' AND policyname = 'participant_scores_insert_policy') THEN
    CREATE POLICY "participant_scores_insert_policy" ON public.golf_participant_scores FOR INSERT
      WITH CHECK (EXISTS ( SELECT 1
         FROM group_post_participants gpp
        WHERE ((gpp.id = golf_participant_scores.participant_id) AND (gpp.profile_id = auth.uid()))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores' AND policyname = 'participant_scores_select_policy') THEN
    CREATE POLICY "participant_scores_select_policy" ON public.golf_participant_scores FOR SELECT
      USING (EXISTS ( SELECT 1
         FROM (group_post_participants gpp
           JOIN group_posts gp ON ((gpp.group_post_id = gp.id)))
        WHERE ((gpp.id = golf_participant_scores.participant_id) AND ((gp.visibility = 'public'::text) OR (gp.creator_id = auth.uid()) OR (gpp.profile_id = auth.uid()) OR (EXISTS ( SELECT 1
                 FROM group_post_participants
                WHERE ((group_post_participants.group_post_id = gp.id) AND (group_post_participants.profile_id = auth.uid()))))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores' AND policyname = 'participant_scores_update_policy') THEN
    CREATE POLICY "participant_scores_update_policy" ON public.golf_participant_scores FOR UPDATE
      USING (EXISTS ( SELECT 1
         FROM group_post_participants gpp
        WHERE ((gpp.id = golf_participant_scores.participant_id) AND ((gpp.profile_id = auth.uid()) OR (EXISTS ( SELECT 1
                 FROM group_posts
                WHERE ((group_posts.id = gpp.group_post_id) AND (group_posts.creator_id = auth.uid()))))))));
  END IF;
END $$;

-- ── golf_rounds — live: 6 policies · recorded here: 6 · stale claims dropped: 5
DROP POLICY IF EXISTS "Users can view their own golf rounds" ON public.golf_rounds; -- 002:39's claim, gone live
DROP POLICY IF EXISTS "Users can insert their own golf rounds" ON public.golf_rounds; -- 002:43's claim, gone live
DROP POLICY IF EXISTS "Users can update their own golf rounds" ON public.golf_rounds; -- 002:47's claim, gone live
DROP POLICY IF EXISTS "Users can delete their own golf rounds" ON public.golf_rounds; -- 002:51's claim, gone live
DROP POLICY IF EXISTS "Users can view golf rounds through posts" ON public.golf_rounds; -- 002:184's claim, gone live
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds' AND policyname = 'golf_rounds_delete_policy') THEN
    CREATE POLICY "golf_rounds_delete_policy" ON public.golf_rounds FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds' AND policyname = 'golf_rounds_guardian_write') THEN
    CREATE POLICY "golf_rounds_guardian_write" ON public.golf_rounds FOR ALL
      USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
      WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds' AND policyname = 'golf_rounds_insert_policy') THEN
    CREATE POLICY "golf_rounds_insert_policy" ON public.golf_rounds FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds' AND policyname = 'golf_rounds_profile_access_select') THEN
    CREATE POLICY "golf_rounds_profile_access_select" ON public.golf_rounds FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds' AND policyname = 'golf_rounds_select_policy') THEN
    CREATE POLICY "golf_rounds_select_policy" ON public.golf_rounds FOR SELECT
      USING ((profile_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
         FROM profiles
        WHERE ((profiles.id = golf_rounds.profile_id) AND ((profiles.visibility = 'public'::text) OR (EXISTS ( SELECT 1
                 FROM follows
                WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = golf_rounds.profile_id) AND (follows.status = 'accepted'::text)))))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds' AND policyname = 'golf_rounds_update_policy') THEN
    CREATE POLICY "golf_rounds_update_policy" ON public.golf_rounds FOR UPDATE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

-- ── golf_scorecard_data — live: 9 policies · recorded here: 6 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data' AND policyname = 'golf_scorecard_data_insert_policy') THEN
    CREATE POLICY "golf_scorecard_data_insert_policy" ON public.golf_scorecard_data FOR INSERT
      WITH CHECK (EXISTS ( SELECT 1
         FROM group_posts
        WHERE ((group_posts.id = golf_scorecard_data.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data' AND policyname = 'golf_scorecard_data_select_policy') THEN
    CREATE POLICY "golf_scorecard_data_select_policy" ON public.golf_scorecard_data FOR SELECT
      USING (EXISTS ( SELECT 1
         FROM group_posts
        WHERE ((group_posts.id = golf_scorecard_data.group_post_id) AND ((group_posts.creator_id = ( SELECT auth.uid() AS uid)) OR (group_posts.visibility = 'public'::text) OR (EXISTS ( SELECT 1
                 FROM group_post_participants
                WHERE ((group_post_participants.group_post_id = golf_scorecard_data.group_post_id) AND (group_post_participants.profile_id = ( SELECT auth.uid() AS uid)))))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data' AND policyname = 'golf_scorecard_data_update_policy') THEN
    CREATE POLICY "golf_scorecard_data_update_policy" ON public.golf_scorecard_data FOR UPDATE
      USING (EXISTS ( SELECT 1
         FROM group_posts
        WHERE ((group_posts.id = golf_scorecard_data.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data' AND policyname = 'scorecard_insert_policy') THEN
    CREATE POLICY "scorecard_insert_policy" ON public.golf_scorecard_data FOR INSERT
      WITH CHECK (EXISTS ( SELECT 1
         FROM group_posts
        WHERE ((group_posts.id = golf_scorecard_data.group_post_id) AND (group_posts.creator_id = auth.uid()))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data' AND policyname = 'scorecard_select_policy') THEN
    CREATE POLICY "scorecard_select_policy" ON public.golf_scorecard_data FOR SELECT
      USING (EXISTS ( SELECT 1
         FROM group_posts
        WHERE ((group_posts.id = golf_scorecard_data.group_post_id) AND ((group_posts.visibility = 'public'::text) OR (group_posts.creator_id = auth.uid()) OR (EXISTS ( SELECT 1
                 FROM group_post_participants
                WHERE ((group_post_participants.group_post_id = group_posts.id) AND (group_post_participants.profile_id = auth.uid()))))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data' AND policyname = 'scorecard_update_policy') THEN
    CREATE POLICY "scorecard_update_policy" ON public.golf_scorecard_data FOR UPDATE
      USING (EXISTS ( SELECT 1
         FROM group_posts
        WHERE ((group_posts.id = golf_scorecard_data.group_post_id) AND (group_posts.creator_id = auth.uid()))));
  END IF;
END $$;

-- ── group_post_media — live: 7 policies · recorded here: 3 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_post_media' AND policyname = 'group_post_media_delete_policy') THEN
    CREATE POLICY "group_post_media_delete_policy" ON public.group_post_media FOR DELETE
      USING ((( SELECT auth.uid() AS uid) = uploaded_by) OR (EXISTS ( SELECT 1
         FROM group_posts
        WHERE ((group_posts.id = group_post_media.group_post_id) AND (group_posts.creator_id = ( SELECT auth.uid() AS uid))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_post_media' AND policyname = 'group_post_media_insert_policy') THEN
    CREATE POLICY "group_post_media_insert_policy" ON public.group_post_media FOR INSERT
      WITH CHECK ((( SELECT auth.uid() AS uid) = uploaded_by) AND (EXISTS ( SELECT 1
         FROM group_post_participants
        WHERE ((group_post_participants.group_post_id = group_post_media.group_post_id) AND (group_post_participants.profile_id = ( SELECT auth.uid() AS uid)) AND (group_post_participants.status = 'confirmed'::text)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_post_media' AND policyname = 'group_post_media_select_policy') THEN
    CREATE POLICY "group_post_media_select_policy" ON public.group_post_media FOR SELECT
      USING ((EXISTS ( SELECT 1
         FROM group_post_participants
        WHERE ((group_post_participants.group_post_id = group_post_media.group_post_id) AND (group_post_participants.profile_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1
         FROM group_posts
        WHERE ((group_posts.id = group_post_media.group_post_id) AND ((group_posts.creator_id = ( SELECT auth.uid() AS uid)) OR (group_posts.visibility = 'public'::text))))));
  END IF;
END $$;

-- ── notification_preferences — live: 3 policies · recorded here: 3 · stale claims dropped: 3
DROP POLICY IF EXISTS "Users can view own preferences" ON public.notification_preferences; -- 003:174's claim, gone live
DROP POLICY IF EXISTS "Users can update own preferences" ON public.notification_preferences; -- 003:178's claim, gone live
DROP POLICY IF EXISTS "Users can insert own preferences" ON public.notification_preferences; -- 003:182's claim, gone live
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_preferences' AND policyname = 'notification_preferences_insert_policy') THEN
    CREATE POLICY "notification_preferences_insert_policy" ON public.notification_preferences FOR INSERT
      WITH CHECK (user_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_preferences' AND policyname = 'notification_preferences_select_policy') THEN
    CREATE POLICY "notification_preferences_select_policy" ON public.notification_preferences FOR SELECT
      USING (user_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_preferences' AND policyname = 'notification_preferences_update_policy') THEN
    CREATE POLICY "notification_preferences_update_policy" ON public.notification_preferences FOR UPDATE
      USING (user_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

-- ── notifications — live: 3 policies · recorded here: 3 · stale claims dropped: 4
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications; -- 003:133's claim, gone live
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications; -- 003:137's claim, gone live
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications; -- 003:141's claim, gone live
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications; -- 003:145's claim, gone live
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notifications_delete_policy') THEN
    CREATE POLICY "notifications_delete_policy" ON public.notifications FOR DELETE
      USING (user_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notifications_select_policy') THEN
    CREATE POLICY "notifications_select_policy" ON public.notifications FOR SELECT
      USING (user_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notifications_update_policy') THEN
    CREATE POLICY "notifications_update_policy" ON public.notifications FOR UPDATE
      USING (user_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

-- ── post_tags — live: 4 policies · recorded here: 4 · stale claims dropped: 6
DROP POLICY IF EXISTS "Anyone can view active tags on public posts" ON public.post_tags; -- 008:62's claim, gone live
DROP POLICY IF EXISTS "Users can view their own tags" ON public.post_tags; -- 008:74's claim, gone live
DROP POLICY IF EXISTS "Users can create tags on their posts" ON public.post_tags; -- 008:82's claim, gone live
DROP POLICY IF EXISTS "Users can update their own tags" ON public.post_tags; -- 008:94's claim, gone live
DROP POLICY IF EXISTS "Users can delete their own tags" ON public.post_tags; -- 008:99's claim, gone live
DROP POLICY IF EXISTS "Tagged users can update their tag status" ON public.post_tags; -- 008:104's claim, gone live
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_tags' AND policyname = 'post_tags_delete_policy') THEN
    CREATE POLICY "post_tags_delete_policy" ON public.post_tags FOR DELETE
      USING (( SELECT auth.uid() AS uid) = created_by_profile_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_tags' AND policyname = 'post_tags_insert_policy') THEN
    CREATE POLICY "post_tags_insert_policy" ON public.post_tags FOR INSERT
      WITH CHECK ((( SELECT auth.uid() AS uid) = created_by_profile_id) AND (EXISTS ( SELECT 1
         FROM posts
        WHERE ((posts.id = post_tags.post_id) AND (posts.profile_id = ( SELECT auth.uid() AS uid))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_tags' AND policyname = 'post_tags_select_policy') THEN
    CREATE POLICY "post_tags_select_policy" ON public.post_tags FOR SELECT
      USING (((status = 'active'::text) AND (EXISTS ( SELECT 1
         FROM posts
        WHERE ((posts.id = post_tags.post_id) AND (posts.visibility = 'public'::text))))) OR ((( SELECT auth.uid() AS uid) = created_by_profile_id) OR (( SELECT auth.uid() AS uid) = tagged_profile_id)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_tags' AND policyname = 'post_tags_update_policy') THEN
    CREATE POLICY "post_tags_update_policy" ON public.post_tags FOR UPDATE
      USING ((( SELECT auth.uid() AS uid) = created_by_profile_id) OR (( SELECT auth.uid() AS uid) = tagged_profile_id));
  END IF;
END $$;

-- ── profiles — live: 3 policies · recorded here: 2 · stale claims dropped: 3
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles; -- 001:48's claim, gone live
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles; -- 001:52's claim, gone live
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles; -- 001:56's claim, gone live
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_select_policy') THEN
    CREATE POLICY "profiles_select_policy" ON public.profiles FOR SELECT
      USING ((id = ( SELECT auth.uid() AS uid)) OR (visibility = 'public'::text) OR (EXISTS ( SELECT 1
         FROM follows
        WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = profiles.id) AND (follows.status = 'accepted'::text)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'profiles_update_policy') THEN
    CREATE POLICY "profiles_update_policy" ON public.profiles FOR UPDATE
      USING (id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

-- ── saved_posts — live: 3 policies · recorded here: 3 · stale claims dropped: 3
DROP POLICY IF EXISTS "Users can view their own saved posts" ON public.saved_posts; -- 007:21's claim, gone live
DROP POLICY IF EXISTS "Users can save posts" ON public.saved_posts; -- 007:25's claim, gone live
DROP POLICY IF EXISTS "Users can unsave their own posts" ON public.saved_posts; -- 007:29's claim, gone live
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_posts' AND policyname = 'saved_posts_delete_policy') THEN
    CREATE POLICY "saved_posts_delete_policy" ON public.saved_posts FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_posts' AND policyname = 'saved_posts_insert_policy') THEN
    CREATE POLICY "saved_posts_insert_policy" ON public.saved_posts FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_posts' AND policyname = 'saved_posts_select_policy') THEN
    CREATE POLICY "saved_posts_select_policy" ON public.saved_posts FOR SELECT
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

-- ── sport_settings — live: 8 policies · recorded here: 4 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_settings' AND policyname = 'sport_settings_delete_policy') THEN
    CREATE POLICY "sport_settings_delete_policy" ON public.sport_settings FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_settings' AND policyname = 'sport_settings_insert_policy') THEN
    CREATE POLICY "sport_settings_insert_policy" ON public.sport_settings FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_settings' AND policyname = 'sport_settings_select_policy') THEN
    CREATE POLICY "sport_settings_select_policy" ON public.sport_settings FOR SELECT
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_settings' AND policyname = 'sport_settings_update_policy') THEN
    CREATE POLICY "sport_settings_update_policy" ON public.sport_settings FOR UPDATE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

-- ── workout_exercises — live: 6 policies · recorded here: 2 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_exercises' AND policyname = 'workout_exercises_guardian_write') THEN
    CREATE POLICY "workout_exercises_guardian_write" ON public.workout_exercises FOR ALL
      USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
      WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_exercises' AND policyname = 'workout_exercises_profile_access_select') THEN
    CREATE POLICY "workout_exercises_profile_access_select" ON public.workout_exercises FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
END $$;

-- ── workout_sessions — live: 6 policies · recorded here: 2 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sessions' AND policyname = 'workout_sessions_guardian_write') THEN
    CREATE POLICY "workout_sessions_guardian_write" ON public.workout_sessions FOR ALL
      USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
      WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sessions' AND policyname = 'workout_sessions_profile_access_select') THEN
    CREATE POLICY "workout_sessions_profile_access_select" ON public.workout_sessions FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
END $$;

-- ── workout_sets — live: 6 policies · recorded here: 2 · stale claims dropped: 0
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sets' AND policyname = 'workout_sets_guardian_write') THEN
    CREATE POLICY "workout_sets_guardian_write" ON public.workout_sets FOR ALL
      USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
      WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sets' AND policyname = 'workout_sets_profile_access_select') THEN
    CREATE POLICY "workout_sets_profile_access_select" ON public.workout_sets FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'athlete_achievements: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_achievements'
UNION ALL

SELECT 'athlete_achievements: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_achievements'
   AND policyname IN ('athlete_achievements_guardian_write', 'athlete_achievements_profile_access_select')
UNION ALL

SELECT 'athlete_vitals: policies' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_vitals'
UNION ALL

SELECT 'athlete_vitals: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'athlete_vitals'
   AND policyname IN ('athlete_vitals_guardian_write', 'athlete_vitals_profile_access_select')
UNION ALL

SELECT 'golf_hole_scores: policies' AS check_name, '7' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores'
UNION ALL

SELECT 'golf_hole_scores: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_hole_scores'
   AND policyname IN ('golf_hole_scores_delete_policy', 'golf_hole_scores_insert_policy', 'golf_hole_scores_update_policy')
UNION ALL

SELECT 'golf_holes: policies' AS check_name, '5' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_holes'
UNION ALL

SELECT 'golf_holes: recorded present', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_holes'
   AND policyname IN ('golf_holes_delete_policy', 'golf_holes_insert_policy', 'golf_holes_select_policy', 'golf_holes_update_policy')
UNION ALL

SELECT 'golf_participant_scores: policies' AS check_name, '8' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores'
UNION ALL

SELECT 'golf_participant_scores: recorded present', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_participant_scores'
   AND policyname IN ('golf_participant_scores_insert_policy', 'golf_participant_scores_update_policy', 'participant_scores_insert_policy', 'participant_scores_select_policy', 'participant_scores_update_policy')
UNION ALL

SELECT 'golf_rounds: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds'
UNION ALL

SELECT 'golf_rounds: recorded present', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_rounds'
   AND policyname IN ('golf_rounds_delete_policy', 'golf_rounds_guardian_write', 'golf_rounds_insert_policy', 'golf_rounds_profile_access_select', 'golf_rounds_select_policy', 'golf_rounds_update_policy')
UNION ALL

SELECT 'golf_scorecard_data: policies' AS check_name, '9' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 9 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data'
UNION ALL

SELECT 'golf_scorecard_data: recorded present', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'golf_scorecard_data'
   AND policyname IN ('golf_scorecard_data_insert_policy', 'golf_scorecard_data_select_policy', 'golf_scorecard_data_update_policy', 'scorecard_insert_policy', 'scorecard_select_policy', 'scorecard_update_policy')
UNION ALL

SELECT 'group_post_media: policies' AS check_name, '7' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_post_media'
UNION ALL

SELECT 'group_post_media: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'group_post_media'
   AND policyname IN ('group_post_media_delete_policy', 'group_post_media_insert_policy', 'group_post_media_select_policy')
UNION ALL

SELECT 'notification_preferences: policies' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_preferences'
UNION ALL

SELECT 'notification_preferences: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notification_preferences'
   AND policyname IN ('notification_preferences_insert_policy', 'notification_preferences_select_policy', 'notification_preferences_update_policy')
UNION ALL

SELECT 'notifications: policies' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
UNION ALL

SELECT 'notifications: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications'
   AND policyname IN ('notifications_delete_policy', 'notifications_select_policy', 'notifications_update_policy')
UNION ALL

SELECT 'post_tags: policies' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_tags'
UNION ALL

SELECT 'post_tags: recorded present', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_tags'
   AND policyname IN ('post_tags_delete_policy', 'post_tags_insert_policy', 'post_tags_select_policy', 'post_tags_update_policy')
UNION ALL

SELECT 'profiles: policies' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
UNION ALL

SELECT 'profiles: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles'
   AND policyname IN ('profiles_select_policy', 'profiles_update_policy')
UNION ALL

SELECT 'saved_posts: policies' AS check_name, '3' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_posts'
UNION ALL

SELECT 'saved_posts: recorded present', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'saved_posts'
   AND policyname IN ('saved_posts_delete_policy', 'saved_posts_insert_policy', 'saved_posts_select_policy')
UNION ALL

SELECT 'sport_settings: policies' AS check_name, '8' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 8 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_settings'
UNION ALL

SELECT 'sport_settings: recorded present', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sport_settings'
   AND policyname IN ('sport_settings_delete_policy', 'sport_settings_insert_policy', 'sport_settings_select_policy', 'sport_settings_update_policy')
UNION ALL

SELECT 'workout_exercises: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_exercises'
UNION ALL

SELECT 'workout_exercises: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_exercises'
   AND policyname IN ('workout_exercises_guardian_write', 'workout_exercises_profile_access_select')
UNION ALL

SELECT 'workout_sessions: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sessions'
UNION ALL

SELECT 'workout_sessions: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sessions'
   AND policyname IN ('workout_sessions_guardian_write', 'workout_sessions_profile_access_select')
UNION ALL

SELECT 'workout_sets: policies' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sets'
UNION ALL

SELECT 'workout_sets: recorded present', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'workout_sets'
   AND policyname IN ('workout_sets_guardian_write', 'workout_sets_profile_access_select')
UNION ALL

SELECT 'stale claims gone', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public'
   AND (tablename, policyname) IN (('profiles', 'Users can view their own profile'), ('profiles', 'Users can insert their own profile'), ('profiles', 'Users can update their own profile'), ('golf_rounds', 'Users can view their own golf rounds'), ('golf_rounds', 'Users can insert their own golf rounds'), ('golf_rounds', 'Users can update their own golf rounds'), ('golf_rounds', 'Users can delete their own golf rounds'), ('golf_holes', 'Users can view holes for their rounds'), ('golf_holes', 'Users can insert holes for their rounds'), ('golf_holes', 'Users can update holes for their rounds'), ('golf_holes', 'Users can delete holes for their rounds'), ('golf_rounds', 'Users can view golf rounds through posts'), ('golf_holes', 'Users can view holes through posts'), ('notifications', 'Users can view own notifications'), ('notifications', 'Users can update own notifications'), ('notifications', 'System can insert notifications'), ('notifications', 'Users can delete own notifications'), ('notification_preferences', 'Users can view own preferences'), ('notification_preferences', 'Users can update own preferences'), ('notification_preferences', 'Users can insert own preferences'), ('saved_posts', 'Users can view their own saved posts'), ('saved_posts', 'Users can save posts'), ('saved_posts', 'Users can unsave their own posts'), ('post_tags', 'Anyone can view active tags on public posts'), ('post_tags', 'Users can view their own tags'), ('post_tags', 'Users can create tags on their posts'), ('post_tags', 'Users can update their own tags'), ('post_tags', 'Users can delete their own tags'), ('post_tags', 'Tagged users can update their tag status'))
UNION ALL

SELECT 'public policies total', '190', count(*)::text,
       CASE WHEN count(*) = 190 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public'

ORDER BY 1;
