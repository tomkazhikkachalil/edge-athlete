-- ============================================================================
-- 271: one permissive policy per (table, command) — the Performance Advisor's
--      multiple_permissive_policies (17 tables) and duplicate_index (6 tables),
--      Oct 25 2026. Runs on BOTH staging and prod; no code change rides with
--      it, nothing deploys first or after. Behaviour-neutral by construction:
--      the OR of each table's policies per command is unchanged.
-- ============================================================================
-- Postgres evaluates EVERY permissive policy for a command on EVERY row and
-- ORs the results, so a second policy on the same (table, command) is one more
-- predicate per row on the hot tables (posts, profiles, post_media, the
-- workout tables). The Advisor listed each pair once per role because every
-- policy here is TO public.
--
-- Where the overlaps came from:
--  1. Migration 052 (guardian feature) added its RLS as ADDITIVE policies —
--     <t>_guardian_write (FOR ALL) and <t>_profile_access_select (FOR SELECT)
--     next to the table's own select/insert/update/delete policies — because
--     the live base bodies were not known then ("so live policy bodies are
--     never clobbered"). 190/191/196 have since written every base body out
--     verbatim, so the arm can live INSIDE the base policy as an OR term.
--     The only helper involved is private.has_profile_access (SECURITY
--     DEFINER, STABLE; 048 → 257). The owner arm stays first in every OR so
--     the common case short-circuits before the helper runs.
--  2. group_post_media carries two byte-identical sets: media_* (chain-owned,
--     004 → 126) and group_post_media_* (an archive script, recorded by 196).
--     sport_settings likewise: 076's "Users can … their own sport settings"
--     and sport_settings_*_policy (196, from an archive). user_blocks has
--     "Users see own blocks" (SELECT) under "Users manage own blocks" (ALL),
--     same predicate. 196's own header asked for exactly this cleanup.
--  3. profiles: 238's one-arm tombstone policy profiles_departed_select
--     ("a tombstone is readable by name") is the same OR, folded.
--
-- The one table without an owner UPDATE / DELETE policy is athlete_vitals
-- (010: SELECT + INSERT only; the routes write through supabaseAdmin). Its
-- FOR ALL guardian policy cannot fold into an update/delete policy that does
-- not exist, so it becomes two NARROW guardian policies (UPDATE, DELETE) that
-- overlap nothing. Owners still cannot update/delete vitals through RLS —
-- unchanged.
--
-- Duplicate indexes: one twin of each pair is dropped; the chain-owned name
-- (004 / 123) is kept, so every FK stays covered (fk-index-coverage.test.ts).
-- Not taken, recorded: idx_post_media_post_id (post_id) is a leading-column
-- prefix of the kept idx_post_media_post_display (post_id, display_order) —
-- not flagged, left for a later decision.
--
-- Pre-flight — the Advisor's lint in SQL (31 rows before, 0 after):
--   SELECT tablename, c, count(*)
--   FROM pg_policies,
--        unnest(CASE cmd WHEN 'ALL' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE'] ELSE ARRAY[cmd] END) AS c
--   WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
--   GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 1, 2;
--
-- Reversal: re-run 052's loops (the arms as separate policies) and the base
-- CREATEs from 190/191/196 — nothing is lost, only the policy shape changes.
-- Re-runnable (every statement IF EXISTS or a drop + recreate).
-- After this file: 145 policies (173 − 30 + 2).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 271) THEN
    RAISE NOTICE '271 already in the ledger here — re-running is harmless, every statement is idempotent';
  END IF;
  IF (SELECT max(number) FROM public.schema_migrations) < 270 THEN
    RAISE EXCEPTION '271 needs the ledger at 270 first (head is %)', (SELECT max(number) FROM public.schema_migrations);
  END IF;
END $$;

-- ── 1a. posts ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS posts_select_policy ON public.posts;
CREATE POLICY posts_select_policy ON public.posts FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR (status = 'published'::text
        AND (visibility = 'public'::text
             OR EXISTS (SELECT 1 FROM follows
                         WHERE follows.follower_id = (SELECT auth.uid())
                           AND follows.following_id = posts.profile_id
                           AND follows.status = 'accepted'::text)))
  );
DROP POLICY IF EXISTS posts_insert_policy ON public.posts;
CREATE POLICY posts_insert_policy ON public.posts FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS posts_update_policy ON public.posts;
CREATE POLICY posts_update_policy ON public.posts FOR UPDATE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS posts_delete_policy ON public.posts;
CREATE POLICY posts_delete_policy ON public.posts FOR DELETE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS posts_guardian_write ON public.posts;
DROP POLICY IF EXISTS posts_profile_access_select ON public.posts;

-- ── 1b. golf_rounds ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS golf_rounds_select_policy ON public.golf_rounds;
CREATE POLICY golf_rounds_select_policy ON public.golf_rounds FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM profiles
                WHERE profiles.id = golf_rounds.profile_id
                  AND (profiles.visibility = 'public'::text
                       OR EXISTS (SELECT 1 FROM follows
                                   WHERE follows.follower_id = (SELECT auth.uid())
                                     AND follows.following_id = golf_rounds.profile_id
                                     AND follows.status = 'accepted'::text)))
  );
DROP POLICY IF EXISTS golf_rounds_insert_policy ON public.golf_rounds;
CREATE POLICY golf_rounds_insert_policy ON public.golf_rounds FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS golf_rounds_update_policy ON public.golf_rounds;
CREATE POLICY golf_rounds_update_policy ON public.golf_rounds FOR UPDATE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS golf_rounds_delete_policy ON public.golf_rounds;
CREATE POLICY golf_rounds_delete_policy ON public.golf_rounds FOR DELETE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS golf_rounds_guardian_write ON public.golf_rounds;
DROP POLICY IF EXISTS golf_rounds_profile_access_select ON public.golf_rounds;

-- ── 1c. athlete_achievements (043's names) ───────────────────────────────────
DROP POLICY IF EXISTS achievements_select_policy ON public.athlete_achievements;
CREATE POLICY achievements_select_policy ON public.athlete_achievements FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = athlete_achievements.profile_id AND p.visibility = 'public'::text)
  );
DROP POLICY IF EXISTS achievements_insert_policy ON public.athlete_achievements;
CREATE POLICY achievements_insert_policy ON public.athlete_achievements FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS achievements_update_policy ON public.athlete_achievements;
CREATE POLICY achievements_update_policy ON public.athlete_achievements FOR UPDATE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS achievements_delete_policy ON public.athlete_achievements;
CREATE POLICY achievements_delete_policy ON public.athlete_achievements FOR DELETE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS athlete_achievements_guardian_write ON public.athlete_achievements;
DROP POLICY IF EXISTS athlete_achievements_profile_access_select ON public.athlete_achievements;

-- ── 1d. athlete_equipment (044 / 249's names) ────────────────────────────────
DROP POLICY IF EXISTS equipment_select_policy ON public.athlete_equipment;
CREATE POLICY equipment_select_policy ON public.athlete_equipment FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = athlete_equipment.profile_id AND p.visibility = 'public'::text)
  );
DROP POLICY IF EXISTS equipment_insert_policy ON public.athlete_equipment;
CREATE POLICY equipment_insert_policy ON public.athlete_equipment FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS equipment_update_policy ON public.athlete_equipment;
CREATE POLICY equipment_update_policy ON public.athlete_equipment FOR UPDATE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS equipment_delete_policy ON public.athlete_equipment;
CREATE POLICY equipment_delete_policy ON public.athlete_equipment FOR DELETE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS athlete_equipment_guardian_write ON public.athlete_equipment;
DROP POLICY IF EXISTS athlete_equipment_profile_access_select ON public.athlete_equipment;

-- ── 1e. workout_sessions / workout_exercises / workout_sets (045's names) ────
DROP POLICY IF EXISTS workout_sessions_select_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_select_policy ON public.workout_sessions FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = workout_sessions.profile_id AND p.visibility = 'public'::text)
  );
DROP POLICY IF EXISTS workout_sessions_insert_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_insert_policy ON public.workout_sessions FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_sessions_update_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_update_policy ON public.workout_sessions FOR UPDATE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_sessions_delete_policy ON public.workout_sessions;
CREATE POLICY workout_sessions_delete_policy ON public.workout_sessions FOR DELETE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_sessions_guardian_write ON public.workout_sessions;
DROP POLICY IF EXISTS workout_sessions_profile_access_select ON public.workout_sessions;

DROP POLICY IF EXISTS workout_exercises_select_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_select_policy ON public.workout_exercises FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = workout_exercises.profile_id AND p.visibility = 'public'::text)
  );
DROP POLICY IF EXISTS workout_exercises_insert_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_insert_policy ON public.workout_exercises FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_exercises_update_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_update_policy ON public.workout_exercises FOR UPDATE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_exercises_delete_policy ON public.workout_exercises;
CREATE POLICY workout_exercises_delete_policy ON public.workout_exercises FOR DELETE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_exercises_guardian_write ON public.workout_exercises;
DROP POLICY IF EXISTS workout_exercises_profile_access_select ON public.workout_exercises;

DROP POLICY IF EXISTS workout_sets_select_policy ON public.workout_sets;
CREATE POLICY workout_sets_select_policy ON public.workout_sets FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = workout_sets.profile_id AND p.visibility = 'public'::text)
  );
DROP POLICY IF EXISTS workout_sets_insert_policy ON public.workout_sets;
CREATE POLICY workout_sets_insert_policy ON public.workout_sets FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_sets_update_policy ON public.workout_sets;
CREATE POLICY workout_sets_update_policy ON public.workout_sets FOR UPDATE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_sets_delete_policy ON public.workout_sets;
CREATE POLICY workout_sets_delete_policy ON public.workout_sets FOR DELETE
  USING (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS workout_sets_guardian_write ON public.workout_sets;
DROP POLICY IF EXISTS workout_sets_profile_access_select ON public.workout_sets;

-- ── 1f. athlete_vitals (010's names; no owner UPDATE / DELETE policy) ────────
DROP POLICY IF EXISTS "Athletes can view own vitals" ON public.athlete_vitals;
CREATE POLICY "Athletes can view own vitals" ON public.athlete_vitals FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = athlete_vitals.profile_id AND p.visibility = 'public'::text)
  );
DROP POLICY IF EXISTS "Athletes can insert own vitals" ON public.athlete_vitals;
CREATE POLICY "Athletes can insert own vitals" ON public.athlete_vitals FOR INSERT
  WITH CHECK (profile_id = (SELECT auth.uid()) OR private.has_profile_access(profile_id, ARRAY['guardian'::text]));
-- The guardian's UPDATE and DELETE, each the ONLY policy for its command.
DROP POLICY IF EXISTS athlete_vitals_guardian_update ON public.athlete_vitals;
CREATE POLICY athlete_vitals_guardian_update ON public.athlete_vitals FOR UPDATE
  USING (private.has_profile_access(profile_id, ARRAY['guardian'::text]))
  WITH CHECK (private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS athlete_vitals_guardian_delete ON public.athlete_vitals;
CREATE POLICY athlete_vitals_guardian_delete ON public.athlete_vitals FOR DELETE
  USING (private.has_profile_access(profile_id, ARRAY['guardian'::text]));
DROP POLICY IF EXISTS athlete_vitals_guardian_write ON public.athlete_vitals;
DROP POLICY IF EXISTS athlete_vitals_profile_access_select ON public.athlete_vitals;

-- ── 1g. golf_holes and post_media — the arm inside the parent EXISTS ─────────
DROP POLICY IF EXISTS golf_holes_select_policy ON public.golf_holes;
CREATE POLICY golf_holes_select_policy ON public.golf_holes FOR SELECT
  USING (EXISTS (SELECT 1 FROM golf_rounds
                  WHERE golf_rounds.id = golf_holes.round_id
                    AND (golf_rounds.profile_id = (SELECT auth.uid())
                         OR private.has_profile_access(golf_rounds.profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
                         OR EXISTS (SELECT 1 FROM profiles
                                     WHERE profiles.id = golf_rounds.profile_id
                                       AND (profiles.visibility = 'public'::text
                                            OR EXISTS (SELECT 1 FROM follows
                                                        WHERE follows.follower_id = (SELECT auth.uid())
                                                          AND follows.following_id = golf_rounds.profile_id
                                                          AND follows.status = 'accepted'::text))))));
DROP POLICY IF EXISTS golf_holes_profile_access_select ON public.golf_holes;

DROP POLICY IF EXISTS post_media_select_policy ON public.post_media;
CREATE POLICY post_media_select_policy ON public.post_media FOR SELECT
  USING (EXISTS (SELECT 1 FROM posts
                  WHERE posts.id = post_media.post_id
                    AND (posts.profile_id = (SELECT auth.uid())
                         OR private.has_profile_access(posts.profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
                         OR posts.visibility = 'public'::text
                         OR EXISTS (SELECT 1 FROM follows
                                     WHERE follows.follower_id = (SELECT auth.uid())
                                       AND follows.following_id = posts.profile_id
                                       AND follows.status = 'accepted'::text))));
DROP POLICY IF EXISTS post_media_profile_access_select ON public.post_media;

-- ── 1h. performances, season_highlights, profiles — one SELECT arm each ──────
DROP POLICY IF EXISTS performances_select_policy ON public.performances;
CREATE POLICY performances_select_policy ON public.performances FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM profiles
                WHERE profiles.id = performances.profile_id
                  AND (profiles.visibility = 'public'::text
                       OR EXISTS (SELECT 1 FROM follows
                                   WHERE follows.follower_id = (SELECT auth.uid())
                                     AND follows.following_id = performances.profile_id
                                     AND follows.status = 'accepted'::text)))
  );
DROP POLICY IF EXISTS performances_profile_access_select ON public.performances;

DROP POLICY IF EXISTS season_highlights_select_policy ON public.season_highlights;
CREATE POLICY season_highlights_select_policy ON public.season_highlights FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR private.has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM profiles
                WHERE profiles.id = season_highlights.profile_id
                  AND (profiles.visibility = 'public'::text
                       OR EXISTS (SELECT 1 FROM follows
                                   WHERE follows.follower_id = (SELECT auth.uid())
                                     AND follows.following_id = season_highlights.profile_id
                                     AND follows.status = 'accepted'::text)))
  );
DROP POLICY IF EXISTS season_highlights_profile_access_select ON public.season_highlights;

DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles FOR SELECT
  USING (
    id = (SELECT auth.uid())
    OR visibility = 'public'::text
    OR departed_at IS NOT NULL                                   -- 238: a tombstone is readable by name
    OR private.has_profile_access(id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text])
    OR EXISTS (SELECT 1 FROM follows
                WHERE follows.follower_id = (SELECT auth.uid())
                  AND follows.following_id = profiles.id
                  AND follows.status = 'accepted'::text)
  );
DROP POLICY IF EXISTS profiles_profile_access_select ON public.profiles;
DROP POLICY IF EXISTS profiles_departed_select ON public.profiles;

-- ── 2. The byte-identical second sets ────────────────────────────────────────
DROP POLICY IF EXISTS group_post_media_select_policy ON public.group_post_media;   -- media_select_policy stays (004 → 126)
DROP POLICY IF EXISTS group_post_media_insert_policy ON public.group_post_media;   -- media_insert_policy stays
DROP POLICY IF EXISTS group_post_media_delete_policy ON public.group_post_media;   -- media_delete_policy stays

DROP POLICY IF EXISTS sport_settings_select_policy ON public.sport_settings;       -- 076's "Users can view their own sport settings" stays
DROP POLICY IF EXISTS sport_settings_insert_policy ON public.sport_settings;
DROP POLICY IF EXISTS sport_settings_update_policy ON public.sport_settings;
DROP POLICY IF EXISTS sport_settings_delete_policy ON public.sport_settings;

DROP POLICY IF EXISTS "Users see own blocks" ON public.user_blocks;                 -- "Users manage own blocks" (FOR ALL) covers SELECT

-- ── 3. One twin of each duplicate index ──────────────────────────────────────
DROP INDEX IF EXISTS public.idx_group_post_media_group;            -- idx_group_post_media_group_post_id stays (group_post_id)
DROP INDEX IF EXISTS public.idx_group_post_media_uploader;         -- idx_group_media_uploader stays (004; uploaded_by)
DROP INDEX IF EXISTS public.idx_group_post_participants_profile;   -- idx_participants_profile stays (004; profile_id)
DROP INDEX IF EXISTS public.idx_comments_post_created;             -- idx_comments_post stays (123; post_id, created_at DESC)
DROP INDEX IF EXISTS public.idx_post_likes_post_id;                -- idx_post_likes_post stays (123; post_id)
DROP INDEX IF EXISTS public.idx_post_media_post_order;             -- idx_post_media_post_display stays (123; post_id, display_order)

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (271, '271_one_permissive_policy_per_command.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 271 APPLIED | 0 | 0 | 0 | 145 | 271
SELECT '271 APPLIED' AS result,
       (SELECT count(*) FROM (
          SELECT p.tablename, c
          FROM pg_policies p,
               unnest(CASE p.cmd WHEN 'ALL' THEN ARRAY['SELECT','INSERT','UPDATE','DELETE'] ELSE ARRAY[p.cmd] END) AS c
          WHERE p.schemaname = 'public' AND p.permissive = 'PERMISSIVE'
          GROUP BY 1, 2 HAVING count(*) > 1) o) AS overlapping_table_cmds_expect_0,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND policyname IN (
           'posts_guardian_write','posts_profile_access_select',
           'golf_rounds_guardian_write','golf_rounds_profile_access_select',
           'athlete_achievements_guardian_write','athlete_achievements_profile_access_select',
           'athlete_equipment_guardian_write','athlete_equipment_profile_access_select',
           'workout_sessions_guardian_write','workout_sessions_profile_access_select',
           'workout_exercises_guardian_write','workout_exercises_profile_access_select',
           'workout_sets_guardian_write','workout_sets_profile_access_select',
           'athlete_vitals_guardian_write','athlete_vitals_profile_access_select',
           'golf_holes_profile_access_select','post_media_profile_access_select',
           'performances_profile_access_select','season_highlights_profile_access_select',
           'profiles_profile_access_select','profiles_departed_select',
           'group_post_media_select_policy','group_post_media_insert_policy','group_post_media_delete_policy',
           'sport_settings_select_policy','sport_settings_insert_policy','sport_settings_update_policy','sport_settings_delete_policy',
           'Users see own blocks')) AS dropped_policies_remaining_expect_0,
       (SELECT count(*) FROM pg_indexes
         WHERE schemaname = 'public' AND indexname IN (
           'idx_group_post_media_group','idx_group_post_media_uploader','idx_group_post_participants_profile',
           'idx_comments_post_created','idx_post_likes_post_id','idx_post_media_post_order')) AS duplicate_indexes_remaining_expect_0,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS policies_expect_145,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_271;
