-- ============================================================================
-- COMPLETE RLS FIX - ALL 66 POLICIES
-- ============================================================================
-- Generated from generate-all-rls-fixes.sql
-- Ready to run - just copy and paste into Supabase SQL Editor
-- ============================================================================

BEGIN;

-- Policy 1: athlete_badges - Users can delete their own badges
DROP POLICY IF EXISTS "Users can delete their own badges" ON public.athlete_badges;
CREATE POLICY "Users can delete their own badges" ON public.athlete_badges AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 2: athlete_badges - Users can insert their own badges
DROP POLICY IF EXISTS "Users can insert their own badges" ON public.athlete_badges;
CREATE POLICY "Users can insert their own badges" ON public.athlete_badges AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 3: athlete_badges - Users can update their own badges
DROP POLICY IF EXISTS "Users can update their own badges" ON public.athlete_badges;
CREATE POLICY "Users can update their own badges" ON public.athlete_badges AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = profile_id));

-- Policy 4: athlete_badges - Users can view their own badges
DROP POLICY IF EXISTS "Users can view their own badges" ON public.athlete_badges;
CREATE POLICY "Users can view their own badges" ON public.athlete_badges AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 5: athlete_clubs - Users can manage their own club associations
DROP POLICY IF EXISTS "Users can manage their own club associations" ON public.athlete_clubs;
CREATE POLICY "Users can manage their own club associations" ON public.athlete_clubs AS PERMISSIVE FOR ALL TO public USING (((select auth.uid()) = athlete_id));

-- Policy 6: athlete_clubs - Users can view their own club associations
DROP POLICY IF EXISTS "Users can view their own club associations" ON public.athlete_clubs;
CREATE POLICY "Users can view their own club associations" ON public.athlete_clubs AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = athlete_id));

-- Policy 7: athlete_performances - Users can manage their own performances
DROP POLICY IF EXISTS "Users can manage their own performances" ON public.athlete_performances;
CREATE POLICY "Users can manage their own performances" ON public.athlete_performances AS PERMISSIVE FOR ALL TO public USING (((select auth.uid()) = profile_id)) WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 8: athlete_performances - Users can view their own performances or public ones
DROP POLICY IF EXISTS "Users can view their own performances or public ones" ON public.athlete_performances;
CREATE POLICY "Users can view their own performances or public ones" ON public.athlete_performances AS PERMISSIVE FOR SELECT TO public USING ((((select auth.uid()) = profile_id) OR (public_visible = true)));

-- Policy 9: athlete_season_highlights - Users can manage their own highlights
DROP POLICY IF EXISTS "Users can manage their own highlights" ON public.athlete_season_highlights;
CREATE POLICY "Users can manage their own highlights" ON public.athlete_season_highlights AS PERMISSIVE FOR ALL TO public USING (((select auth.uid()) = profile_id)) WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 10: athlete_season_highlights - Users can view their own highlights
DROP POLICY IF EXISTS "Users can view their own highlights" ON public.athlete_season_highlights;
CREATE POLICY "Users can view their own highlights" ON public.athlete_season_highlights AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 11: athlete_socials - Users can delete their own socials
DROP POLICY IF EXISTS "Users can delete their own socials" ON public.athlete_socials;
CREATE POLICY "Users can delete their own socials" ON public.athlete_socials AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 12: athlete_socials - Users can manage their own socials
DROP POLICY IF EXISTS "Users can manage their own socials" ON public.athlete_socials;
CREATE POLICY "Users can manage their own socials" ON public.athlete_socials AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 13: athlete_socials - Users can update their own socials
DROP POLICY IF EXISTS "Users can update their own socials" ON public.athlete_socials;
CREATE POLICY "Users can update their own socials" ON public.athlete_socials AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = profile_id));

-- Policy 14: athlete_vitals - Users can manage their own vitals
DROP POLICY IF EXISTS "Users can manage their own vitals" ON public.athlete_vitals;
CREATE POLICY "Users can manage their own vitals" ON public.athlete_vitals AS PERMISSIVE FOR ALL TO public USING (((select auth.uid()) = profile_id)) WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 15: athlete_vitals - Users can view their own vitals
DROP POLICY IF EXISTS "Users can view their own vitals" ON public.athlete_vitals;
CREATE POLICY "Users can view their own vitals" ON public.athlete_vitals AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 16: comment_likes - Users can like comments
DROP POLICY IF EXISTS "Users can like comments" ON public.comment_likes;
CREATE POLICY "Users can like comments" ON public.comment_likes AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 17: comment_likes - Users can unlike comments
DROP POLICY IF EXISTS "Users can unlike comments" ON public.comment_likes;
CREATE POLICY "Users can unlike comments" ON public.comment_likes AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 18: connection_suggestions - Users can dismiss their own suggestions
DROP POLICY IF EXISTS "Users can dismiss their own suggestions" ON public.connection_suggestions;
CREATE POLICY "Users can dismiss their own suggestions" ON public.connection_suggestions AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = profile_id));

-- Policy 19: connection_suggestions - Users can view their own suggestions
DROP POLICY IF EXISTS "Users can view their own suggestions" ON public.connection_suggestions;
CREATE POLICY "Users can view their own suggestions" ON public.connection_suggestions AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 20: follows - Users can create follows
DROP POLICY IF EXISTS "Users can create follows" ON public.follows;
CREATE POLICY "Users can create follows" ON public.follows AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = follower_id));

-- Policy 21: follows - Users can delete their own follows
DROP POLICY IF EXISTS "Users can delete their own follows" ON public.follows;
CREATE POLICY "Users can delete their own follows" ON public.follows AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = follower_id));

-- Policy 22: follows - Users can update their own follows
DROP POLICY IF EXISTS "Users can update their own follows" ON public.follows;
CREATE POLICY "Users can update their own follows" ON public.follows AS PERMISSIVE FOR UPDATE TO public USING ((((select auth.uid()) = follower_id) OR ((select auth.uid()) = following_id)));

-- Policy 23: follows - Users can view their own follows
DROP POLICY IF EXISTS "Users can view their own follows" ON public.follows;
CREATE POLICY "Users can view their own follows" ON public.follows AS PERMISSIVE FOR SELECT TO public USING ((((select auth.uid()) = follower_id) OR ((select auth.uid()) = following_id)));

-- Policy 24: golf_rounds - Users can delete their own golf rounds
DROP POLICY IF EXISTS "Users can delete their own golf rounds" ON public.golf_rounds;
CREATE POLICY "Users can delete their own golf rounds" ON public.golf_rounds AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 25: golf_rounds - Users can insert their own golf rounds
DROP POLICY IF EXISTS "Users can insert their own golf rounds" ON public.golf_rounds;
CREATE POLICY "Users can insert their own golf rounds" ON public.golf_rounds AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 26: golf_rounds - Users can update their own golf rounds
DROP POLICY IF EXISTS "Users can update their own golf rounds" ON public.golf_rounds;
CREATE POLICY "Users can update their own golf rounds" ON public.golf_rounds AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = profile_id));

-- Policy 27: golf_rounds - Users can view their own golf rounds
DROP POLICY IF EXISTS "Users can view their own golf rounds" ON public.golf_rounds;
CREATE POLICY "Users can view their own golf rounds" ON public.golf_rounds AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 28: handle_history - Users can view their own handle history
DROP POLICY IF EXISTS "Users can view their own handle history" ON public.handle_history;
CREATE POLICY "Users can view their own handle history" ON public.handle_history AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 29: notification_preferences - Users can insert own preferences
DROP POLICY IF EXISTS "Users can insert own preferences" ON public.notification_preferences;
CREATE POLICY "Users can insert own preferences" ON public.notification_preferences AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = user_id));

-- Policy 30: notification_preferences - Users can update own preferences
DROP POLICY IF EXISTS "Users can update own preferences" ON public.notification_preferences;
CREATE POLICY "Users can update own preferences" ON public.notification_preferences AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = user_id));

-- Policy 31: notification_preferences - Users can view own preferences
DROP POLICY IF EXISTS "Users can view own preferences" ON public.notification_preferences;
CREATE POLICY "Users can view own preferences" ON public.notification_preferences AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = user_id));

-- Policy 32: notifications - Users can delete own notifications
DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications" ON public.notifications AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = user_id));

-- Policy 33: notifications - Users can update own notifications
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications" ON public.notifications AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = user_id));

-- Policy 34: notifications - Users can view own notifications
DROP POLICY IF EXISTS "Users can view own notifications" ON public.notifications;
CREATE POLICY "Users can view own notifications" ON public.notifications AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = user_id));

-- Policy 35: performances - Users can manage their own performances
DROP POLICY IF EXISTS "Users can manage their own performances" ON public.performances;
CREATE POLICY "Users can manage their own performances" ON public.performances AS PERMISSIVE FOR ALL TO public USING ((profile_id = (select auth.uid()))) WITH CHECK ((profile_id = (select auth.uid())));

-- Policy 36: performances - Users can view their own performances
DROP POLICY IF EXISTS "Users can view their own performances" ON public.performances;
CREATE POLICY "Users can view their own performances" ON public.performances AS PERMISSIVE FOR SELECT TO public USING ((profile_id = (select auth.uid())));

-- Policy 37: post_comments - Users can delete their own comments
DROP POLICY IF EXISTS "Users can delete their own comments" ON public.post_comments;
CREATE POLICY "Users can delete their own comments" ON public.post_comments AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 38: post_comments - Users can update their own comments
DROP POLICY IF EXISTS "Users can update their own comments" ON public.post_comments;
CREATE POLICY "Users can update their own comments" ON public.post_comments AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = profile_id)) WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 39: post_likes - Users can like posts
DROP POLICY IF EXISTS "Users can like posts" ON public.post_likes;
CREATE POLICY "Users can like posts" ON public.post_likes AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 40: post_likes - Users can remove their own likes
DROP POLICY IF EXISTS "Users can remove their own likes" ON public.post_likes;
CREATE POLICY "Users can remove their own likes" ON public.post_likes AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 41: post_likes - Users can unlike their own likes
DROP POLICY IF EXISTS "Users can unlike their own likes" ON public.post_likes;
CREATE POLICY "Users can unlike their own likes" ON public.post_likes AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 42: post_tags - Tagged users can update their tag status
DROP POLICY IF EXISTS "Tagged users can update their tag status" ON public.post_tags;
CREATE POLICY "Tagged users can update their tag status" ON public.post_tags AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = tagged_profile_id));

-- Policy 43: post_tags - Users can delete their own tags
DROP POLICY IF EXISTS "Users can delete their own tags" ON public.post_tags;
CREATE POLICY "Users can delete their own tags" ON public.post_tags AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = created_by_profile_id));

-- Policy 44: post_tags - Users can update their own tags
DROP POLICY IF EXISTS "Users can update their own tags" ON public.post_tags;
CREATE POLICY "Users can update their own tags" ON public.post_tags AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = created_by_profile_id));

-- Policy 45: post_tags - Users can view their own tags
DROP POLICY IF EXISTS "Users can view their own tags" ON public.post_tags;
CREATE POLICY "Users can view their own tags" ON public.post_tags AS PERMISSIVE FOR SELECT TO public USING ((((select auth.uid()) = created_by_profile_id) OR ((select auth.uid()) = tagged_profile_id)));

-- Policy 46: posts - Users can create their own posts
DROP POLICY IF EXISTS "Users can create their own posts" ON public.posts;
CREATE POLICY "Users can create their own posts" ON public.posts AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 47: posts - Users can delete their own posts
DROP POLICY IF EXISTS "Users can delete their own posts" ON public.posts;
CREATE POLICY "Users can delete their own posts" ON public.posts AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 48: posts - Users can update their own posts
DROP POLICY IF EXISTS "Users can update their own posts" ON public.posts;
CREATE POLICY "Users can update their own posts" ON public.posts AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = profile_id)) WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 49: posts - Users can view their own posts
DROP POLICY IF EXISTS "Users can view their own posts" ON public.posts;
CREATE POLICY "Users can view their own posts" ON public.posts AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 50: privacy_settings - Users can update their own privacy settings
DROP POLICY IF EXISTS "Users can update their own privacy settings" ON public.privacy_settings;
CREATE POLICY "Users can update their own privacy settings" ON public.privacy_settings AS PERMISSIVE FOR ALL TO public USING (((select auth.uid()) = profile_id));

-- Policy 51: privacy_settings - Users can view their own privacy settings
DROP POLICY IF EXISTS "Users can view their own privacy settings" ON public.privacy_settings;
CREATE POLICY "Users can view their own privacy settings" ON public.privacy_settings AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 52: profiles - Users can delete their own profile
DROP POLICY IF EXISTS "Users can delete their own profile" ON public.profiles;
CREATE POLICY "Users can delete their own profile" ON public.profiles AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = id));

-- Policy 53: profiles - Users can insert their own profile
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = id));

-- Policy 54: profiles - Users can update their own profile
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = id)) WITH CHECK (((select auth.uid()) = id));

-- Policy 55: profiles - Users can view their own profile
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = id));

-- Policy 56: saved_posts - Users can save posts
DROP POLICY IF EXISTS "Users can save posts" ON public.saved_posts;
CREATE POLICY "Users can save posts" ON public.saved_posts AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 57: saved_posts - Users can unsave their own posts
DROP POLICY IF EXISTS "Users can unsave their own posts" ON public.saved_posts;
CREATE POLICY "Users can unsave their own posts" ON public.saved_posts AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 58: saved_posts - Users can view their own saved posts
DROP POLICY IF EXISTS "Users can view their own saved posts" ON public.saved_posts;
CREATE POLICY "Users can view their own saved posts" ON public.saved_posts AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 59: season_highlights - Users can manage their own highlights
DROP POLICY IF EXISTS "Users can manage their own highlights" ON public.season_highlights;
CREATE POLICY "Users can manage their own highlights" ON public.season_highlights AS PERMISSIVE FOR ALL TO public USING ((profile_id = (select auth.uid()))) WITH CHECK ((profile_id = (select auth.uid())));

-- Policy 60: season_highlights - Users can view their own highlights
DROP POLICY IF EXISTS "Users can view their own highlights" ON public.season_highlights;
CREATE POLICY "Users can view their own highlights" ON public.season_highlights AS PERMISSIVE FOR SELECT TO public USING ((profile_id = (select auth.uid())));

-- Policy 61: sport_settings - Users can delete their own sport settings
DROP POLICY IF EXISTS "Users can delete their own sport settings" ON public.sport_settings;
CREATE POLICY "Users can delete their own sport settings" ON public.sport_settings AS PERMISSIVE FOR DELETE TO public USING (((select auth.uid()) = profile_id));

-- Policy 62: sport_settings - Users can insert their own sport settings
DROP POLICY IF EXISTS "Users can insert their own sport settings" ON public.sport_settings;
CREATE POLICY "Users can insert their own sport settings" ON public.sport_settings AS PERMISSIVE FOR INSERT TO public WITH CHECK (((select auth.uid()) = profile_id));

-- Policy 63: sport_settings - Users can update their own sport settings
DROP POLICY IF EXISTS "Users can update their own sport settings" ON public.sport_settings;
CREATE POLICY "Users can update their own sport settings" ON public.sport_settings AS PERMISSIVE FOR UPDATE TO public USING (((select auth.uid()) = profile_id));

-- Policy 64: sport_settings - Users can view their own sport settings
DROP POLICY IF EXISTS "Users can view their own sport settings" ON public.sport_settings;
CREATE POLICY "Users can view their own sport settings" ON public.sport_settings AS PERMISSIVE FOR SELECT TO public USING (((select auth.uid()) = profile_id));

-- Policy 65: sports - Users can manage their own sports
DROP POLICY IF EXISTS "Users can manage their own sports" ON public.sports;
CREATE POLICY "Users can manage their own sports" ON public.sports AS PERMISSIVE FOR ALL TO public USING ((profile_id = (select auth.uid()))) WITH CHECK ((profile_id = (select auth.uid())));

-- Policy 66: sports - Users can view their own sports
DROP POLICY IF EXISTS "Users can view their own sports" ON public.sports;
CREATE POLICY "Users can view their own sports" ON public.sports AS PERMISSIVE FOR SELECT TO public USING ((profile_id = (select auth.uid())));

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check how many policies still need fixing (should be 0)
SELECT COUNT(*) as remaining_issues
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    (qual IS NOT NULL AND qual ~ 'auth\.uid\(\)' AND qual !~* 'SELECT.*auth\.uid\(\)')
    OR
    (with_check IS NOT NULL AND with_check ~ 'auth\.uid\(\)' AND with_check !~* 'SELECT.*auth\.uid\(\)')
    OR
    (qual IS NOT NULL AND qual ~ 'auth\.jwt\(\)' AND qual !~* 'SELECT.*auth\.jwt\(\)')
    OR
    (with_check IS NOT NULL AND with_check ~ 'auth\.jwt\(\)' AND with_check !~* 'SELECT.*auth\.jwt\(\)')
  );

-- ============================================================================
-- IMPORTANT: Review the remaining_issues result above
-- ============================================================================
-- If remaining_issues = 0:
--   1. Uncomment the COMMIT; line below
--   2. Run COMMIT;
--   3. Wait 5-10 minutes
--   4. Check Supabase Performance Advisor (358 → ~292 warnings expected)
--
-- If remaining_issues > 0:
--   1. Run ROLLBACK; instead
--   2. Investigate which policies failed
-- ============================================================================

-- COMMIT;  -- Uncomment this line after verifying remaining_issues = 0

