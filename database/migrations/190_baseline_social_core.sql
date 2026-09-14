-- ============================================================================
-- 190: BASELINE — the social core, recorded from the live database
--      (data foundation, P2 — Sep 14 2026)
-- ============================================================================
-- follows · posts · post_media · post_likes · post_comments · comment_likes
-- were created by archived scripts (database/archive/loose-legacy/
-- create_posts_tables.sql, create_follows_table.sql, database/features/
-- notifications/add-comment-likes.sql) and the numbered chain has ALTERed
-- them for a year without ever creating them. This file is the chain's first
-- CREATE of each: the LIVE shape, copied from the Sep 14 2026 dump
-- (database/provenance/dumps/2026-09-14-live-dump.csv) — types with their
-- precision, defaults verbatim, every constraint under its live name with its
-- ON DELETE, every index by its live indexdef, RLS and the live grants,
-- every policy with its body VERBATIM, every trigger, and the trigger
-- functions no numbered file defines. From here on the repo is the source of
-- truth for these six tables; `npm run check:schema` proves it and the
-- allowlist entries for them are gone.
--
-- A NO-OP ON PRODUCTION — drops nothing, changes nothing, re-runnable:
--   * CREATE TABLE IF NOT EXISTS with the full live body; then ADD COLUMN IF
--     NOT EXISTS for the columns no numbered file adds (this is where
--     post_media.width / height / duration — defined NOWHERE in the repo
--     until now — and post_comments.likes_count land);
--   * constraints and policies behind a pg_constraint / pg_policies lookup;
--   * CREATE INDEX IF NOT EXISTS (these tables hold 3–36 rows on production;
--     a table that grows large gets its NEXT index in a `.indexes.sql`
--     twin — MIGRATIONS.md, "Large-table indexes");
--   * DROP TRIGGER IF EXISTS + CREATE TRIGGER (the 194 idiom);
--   * CREATE OR REPLACE FUNCTION for the seven trigger functions the chain
--     never defined, bodies verbatim from grid 7 — the functions a numbered
--     file DOES define (notify_follow_*, notify_post_comment, the search-doc
--     sync, the three count functions) stay with their owner.
--
-- A baseline never "improves" live behaviour; a later migration may. What
-- this one RECORDS as it found it (candidates for that later migration):
--   * post_comments and post_likes each carry TWO count triggers calling the
--     same function (trigger_update_post_comments_count — INSERT/DELETE/
--     UPDATE OF status, the 129 shape — beside the older
--     update_post_comments_count_trigger; likewise for likes). Both fire;
--     the recount is idempotent, so the cost is one redundant UPDATE per
--     like/comment.
--   * post_comments.likes_count is maintained by increment/decrement
--     triggers on comment_likes (the loose file's shape), not by a recount.
--   * comment_likes / post_likes / post_comments SELECT policies are
--     USING (true): the tables are readable by any signed-in role
--     (visibility is enforced one level up, on posts).
--   * posts_visibility_check still admits 'followers' although the app's
--     privacy model is public | private.
--   * follows_select_policy shows a follow edge only to its two ends; the
--     policies that read follows from other tables run as the table owner
--     through the policy expression, so this is not a leak.
--   * Every policy is `roles=public` (no TO clause) — as live.
--   * The grants are Supabase's defaults: ALL to anon, authenticated and
--     service_role, RLS doing the gating.
-- The pre-dump reference files stay under archive/ and features/ as
-- history; nothing runs from there.
--
-- Order: follows first (posts' policies read it), then posts and its
-- children. Tables it references that the chain already owns: profiles
-- (001), golf_rounds (002), group_posts, contests, events.
-- ============================================================================

-- ── Trigger functions no numbered file defines (grid 7, verbatim) ───────────
CREATE OR REPLACE FUNCTION public.update_follows_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.posts_search_vector_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.search_vector := setweight(to_tsvector('english', COALESCE(NEW.caption, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.tags, ' '), '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(NEW.hashtags, ' '), '')), 'B');
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.increment_comment_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.post_comments
  SET likes_count = likes_count + 1
  WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.decrement_comment_likes_count()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.post_comments
  SET likes_count = GREATEST(0, likes_count - 1)
  WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.notify_post_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
    DECLARE
      v_post_owner UUID;
      v_actor_name TEXT;
    BEGIN
      SELECT profile_id INTO v_post_owner FROM public.posts WHERE id = NEW.post_id;
      IF v_post_owner IS NULL OR v_post_owner = NEW.profile_id THEN
        RETURN NEW;
      END IF;

      v_actor_name := public.get_actor_display_name(NEW.profile_id);

      PERFORM public.create_notification(
        p_user_id := v_post_owner,
        p_type := 'like',
        p_actor_id := NEW.profile_id,
        p_title := v_actor_name || ' liked your post',
        p_action_url := '/feed',
        p_post_id := NEW.post_id,
        p_metadata := jsonb_build_object('post_id', NEW.post_id)
      );
      RETURN NEW;
    END;
    $function$;

CREATE OR REPLACE FUNCTION public.notify_comment_like()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
      DECLARE
        v_actor_name TEXT;
        v_comment_author UUID;
      BEGIN
        -- SCHEMA-QUALIFIED post_comments table
        SELECT profile_id INTO v_comment_author FROM public.post_comments WHERE id = NEW.comment_id;
        IF v_comment_author = NEW.profile_id THEN RETURN NEW; END IF;

        -- SCHEMA-QUALIFIED profiles table
        SELECT COALESCE(first_name || ' ' || last_name, full_name, 'Someone')
        INTO v_actor_name FROM public.profiles WHERE id = NEW.profile_id;

        -- SCHEMA-QUALIFIED function call
        PERFORM public.create_notification(
          p_user_id := v_comment_author,
          p_type := 'like',
          p_actor_id := NEW.profile_id,
          p_title := v_actor_name || ' liked your comment',
          p_action_url := '/feed?comment=' || NEW.comment_id,
          p_comment_id := NEW.comment_id,
          p_metadata := jsonb_build_object('comment_id', NEW.comment_id)
        );
        RETURN NEW;
      END;
      $function$;

-- ── follows — live: 7 columns · 5 constraints · 7 indexes · 4 policies · 5 triggers
CREATE TABLE IF NOT EXISTS public.follows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL,
  following_id uuid NOT NULL,
  status text DEFAULT 'accepted'::text,
  message text,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT follows_pkey PRIMARY KEY (id),
  CONSTRAINT follows_follower_id_following_id_key UNIQUE (follower_id, following_id),
  CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT follows_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])))
);

-- An existing table gets every column here (no numbered file ALTERs it).
ALTER TABLE public.follows
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS follower_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS following_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'accepted'::text,
  ADD COLUMN IF NOT EXISTS message text,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_pkey' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_follower_id_following_id_key' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_follower_id_following_id_key UNIQUE (follower_id, following_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_follower_id_fkey' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_following_id_fkey' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_following_id_fkey FOREIGN KEY (following_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_status_check' AND conrelid = 'public.follows'::regclass) THEN
    ALTER TABLE public.follows ADD CONSTRAINT follows_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'rejected'::text])));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_follows_composite ON public.follows USING btree (follower_id, following_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON public.follows USING btree (follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_status ON public.follows USING btree (follower_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_following ON public.follows USING btree (following_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_status ON public.follows USING btree (following_id, status);
CREATE INDEX IF NOT EXISTS idx_follows_status ON public.follows USING btree (status);

ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.follows TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'follows' AND policyname = 'follows_delete_policy') THEN
    CREATE POLICY follows_delete_policy ON public.follows FOR DELETE
      USING (follower_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'follows' AND policyname = 'follows_insert_policy') THEN
    CREATE POLICY follows_insert_policy ON public.follows FOR INSERT
      WITH CHECK (follower_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'follows' AND policyname = 'follows_select_policy') THEN
    CREATE POLICY follows_select_policy ON public.follows FOR SELECT
      USING ((follower_id = ( SELECT auth.uid() AS uid)) OR (following_id = ( SELECT auth.uid() AS uid)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'follows' AND policyname = 'follows_update_policy') THEN
    CREATE POLICY follows_update_policy ON public.follows FOR UPDATE
      USING (following_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

DROP TRIGGER IF EXISTS set_follows_updated_at ON public.follows;
CREATE TRIGGER set_follows_updated_at BEFORE UPDATE ON public.follows FOR EACH ROW EXECUTE FUNCTION update_follows_updated_at();
DROP TRIGGER IF EXISTS trigger_notify_follow_accepted ON public.follows;
CREATE TRIGGER trigger_notify_follow_accepted AFTER UPDATE ON public.follows FOR EACH ROW EXECUTE FUNCTION notify_follow_accepted();
DROP TRIGGER IF EXISTS trigger_notify_follow_declined ON public.follows;
CREATE TRIGGER trigger_notify_follow_declined BEFORE DELETE ON public.follows FOR EACH ROW WHEN ((old.status = 'pending'::text)) EXECUTE FUNCTION notify_follow_declined();
DROP TRIGGER IF EXISTS trigger_notify_follow_request ON public.follows;
CREATE TRIGGER trigger_notify_follow_request AFTER INSERT ON public.follows FOR EACH ROW EXECUTE FUNCTION notify_follow_request();
DROP TRIGGER IF EXISTS trigger_notify_new_follower ON public.follows;
CREATE TRIGGER trigger_notify_new_follower AFTER INSERT ON public.follows FOR EACH ROW WHEN ((new.status = 'accepted'::text)) EXECUTE FUNCTION notify_new_follower();

-- ── posts — live: 29 columns · 11 constraints · 20 indexes · 6 policies · 5 triggers
CREATE TABLE IF NOT EXISTS public.posts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL,
  sport_key text,
  caption text,
  visibility text DEFAULT 'public'::text,
  stats_data jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  likes_count integer DEFAULT 0,
  comments_count integer DEFAULT 0,
  shares_count integer DEFAULT 0,
  tags text[] DEFAULT '{}'::text[],
  hashtags text[] DEFAULT '{}'::text[],
  round_id uuid,
  search_vector tsvector,
  saves_count integer NOT NULL DEFAULT 0,
  group_post_id uuid,
  activity_mode text,
  is_pinned boolean NOT NULL DEFAULT false,
  pinned_at timestamp with time zone,
  status text NOT NULL DEFAULT 'published'::text,
  shared_post_id uuid,
  reposts_count integer NOT NULL DEFAULT 0,
  post_category text,
  created_by_user_id uuid,
  review_note text,
  approval_nudged_at timestamp with time zone,
  event_id uuid,
  contest_id uuid,
  CONSTRAINT posts_pkey PRIMARY KEY (id),
  CONSTRAINT posts_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE SET NULL,
  CONSTRAINT posts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT posts_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
  CONSTRAINT posts_group_post_id_fkey FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE SET NULL,
  CONSTRAINT posts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT posts_round_id_fkey FOREIGN KEY (round_id) REFERENCES golf_rounds(id) ON DELETE SET NULL,
  CONSTRAINT posts_shared_post_id_fkey FOREIGN KEY (shared_post_id) REFERENCES posts(id) ON DELETE SET NULL,
  CONSTRAINT check_golf_sources CHECK ((NOT ((round_id IS NOT NULL) AND (group_post_id IS NOT NULL)))),
  CONSTRAINT posts_status_check CHECK ((status = ANY (ARRAY['published'::text, 'pending_approval'::text, 'rejected'::text, 'changes_requested'::text]))),
  CONSTRAINT posts_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text, 'followers'::text])))
);

-- An existing table gets the columns no numbered file adds (the chain
-- ALTERs the other 14 in 002, 007, 020, 023, 034, 051, 075, 077, 090, 129, 134, 181).
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS sport_key text,
  ADD COLUMN IF NOT EXISTS caption text,
  ADD COLUMN IF NOT EXISTS visibility text DEFAULT 'public'::text,
  ADD COLUMN IF NOT EXISTS stats_data jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS likes_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comments_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shares_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS hashtags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS search_vector tsvector,
  ADD COLUMN IF NOT EXISTS group_post_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_pkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_contest_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_contest_id_fkey FOREIGN KEY (contest_id) REFERENCES contests(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_created_by_user_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_event_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_group_post_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_group_post_id_fkey FOREIGN KEY (group_post_id) REFERENCES group_posts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_profile_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_round_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_round_id_fkey FOREIGN KEY (round_id) REFERENCES golf_rounds(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_shared_post_id_fkey' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_shared_post_id_fkey FOREIGN KEY (shared_post_id) REFERENCES posts(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'check_golf_sources' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT check_golf_sources CHECK ((NOT ((round_id IS NOT NULL) AND (group_post_id IS NOT NULL))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_status_check' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_status_check CHECK ((status = ANY (ARRAY['published'::text, 'pending_approval'::text, 'rejected'::text, 'changes_requested'::text])));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_visibility_check' AND conrelid = 'public.posts'::regclass) THEN
    ALTER TABLE public.posts ADD CONSTRAINT posts_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text, 'followers'::text])));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_posts_category_profile_created ON public.posts USING btree (post_category, profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_contest ON public.posts USING btree (contest_id) WHERE (contest_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON public.posts USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_at_id_desc ON public.posts USING btree (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_by ON public.posts USING btree (created_by_user_id) WHERE (created_by_user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_event_id ON public.posts USING btree (event_id) WHERE (event_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_group_post_id ON public.posts USING btree (group_post_id);
CREATE INDEX IF NOT EXISTS idx_posts_pending_nudge ON public.posts USING btree (created_at) WHERE ((status = 'pending_approval'::text) AND (approval_nudged_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON public.posts USING btree (profile_id, pinned_at DESC) WHERE (is_pinned = true);
CREATE INDEX IF NOT EXISTS idx_posts_profile_created ON public.posts USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_profile_id ON public.posts USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_posts_profile_visibility_created ON public.posts USING btree (profile_id, visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_round_id ON public.posts USING btree (round_id);
CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON public.posts USING gin (search_vector);
CREATE INDEX IF NOT EXISTS idx_posts_shared_post_id ON public.posts USING btree (shared_post_id) WHERE (shared_post_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_posts_stat_line_date ON public.posts USING btree (profile_id, ((stats_data ->> 'date'::text))) WHERE ((stats_data ->> 'type'::text) = 'stat_line'::text);
CREATE INDEX IF NOT EXISTS idx_posts_stats_media ON public.posts USING btree (profile_id, created_at DESC) WHERE (((stats_data IS NOT NULL) AND (stats_data <> '{}'::jsonb)) OR (round_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS idx_posts_status_pending ON public.posts USING btree (profile_id) WHERE (status <> 'published'::text);
CREATE INDEX IF NOT EXISTS idx_posts_tags_gin ON public.posts USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_posts_visibility_created ON public.posts USING btree (visibility, created_at DESC);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.posts TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts' AND policyname = 'posts_delete_policy') THEN
    CREATE POLICY posts_delete_policy ON public.posts FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts' AND policyname = 'posts_guardian_write') THEN
    CREATE POLICY posts_guardian_write ON public.posts FOR ALL
      USING (has_profile_access(profile_id, ARRAY['guardian'::text]))
      WITH CHECK (has_profile_access(profile_id, ARRAY['guardian'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts' AND policyname = 'posts_insert_policy') THEN
    CREATE POLICY posts_insert_policy ON public.posts FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts' AND policyname = 'posts_profile_access_select') THEN
    CREATE POLICY posts_profile_access_select ON public.posts FOR SELECT
      USING (has_profile_access(profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts' AND policyname = 'posts_select_policy') THEN
    CREATE POLICY posts_select_policy ON public.posts FOR SELECT
      USING ((profile_id = ( SELECT auth.uid() AS uid)) OR ((status = 'published'::text) AND ((visibility = 'public'::text) OR (EXISTS ( SELECT 1
         FROM follows
        WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = posts.profile_id) AND (follows.status = 'accepted'::text)))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts' AND policyname = 'posts_update_policy') THEN
    CREATE POLICY posts_update_policy ON public.posts FOR UPDATE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

DROP TRIGGER IF EXISTS posts_search_doc ON public.posts;
CREATE TRIGGER posts_search_doc AFTER INSERT OR UPDATE OF caption, hashtags, sport_key, visibility, status ON public.posts FOR EACH ROW EXECUTE FUNCTION search_doc_sync_post();
DROP TRIGGER IF EXISTS posts_search_doc_delete ON public.posts;
CREATE TRIGGER posts_search_doc_delete AFTER DELETE ON public.posts FOR EACH ROW EXECUTE FUNCTION search_document_delete('post');
DROP TRIGGER IF EXISTS posts_search_vector_trigger ON public.posts;
CREATE TRIGGER posts_search_vector_trigger BEFORE INSERT OR UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION posts_search_vector_update();
DROP TRIGGER IF EXISTS trigger_update_post_reposts_count ON public.posts;
CREATE TRIGGER trigger_update_post_reposts_count AFTER INSERT OR DELETE OR UPDATE OF shared_post_id ON public.posts FOR EACH ROW EXECUTE FUNCTION update_post_reposts_count();
DROP TRIGGER IF EXISTS update_posts_updated_at ON public.posts;
CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON public.posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ── post_media — live: 12 columns · 3 constraints · 3 indexes · 5 policies · 0 triggers
CREATE TABLE IF NOT EXISTS public.post_media (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  media_url text NOT NULL,
  media_type text NOT NULL,
  thumbnail_url text,
  display_order integer DEFAULT 0,
  width integer,
  height integer,
  duration integer,
  created_at timestamp with time zone DEFAULT now(),
  source_url text,
  edit_recipe jsonb,
  CONSTRAINT post_media_pkey PRIMARY KEY (id),
  CONSTRAINT post_media_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT post_media_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])))
);

-- An existing table gets the columns no numbered file adds (the chain
-- ALTERs the other 2 in 120).
ALTER TABLE public.post_media
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS post_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS media_url text NOT NULL,
  ADD COLUMN IF NOT EXISTS media_type text NOT NULL,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS display_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS duration integer,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_media_pkey' AND conrelid = 'public.post_media'::regclass) THEN
    ALTER TABLE public.post_media ADD CONSTRAINT post_media_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_media_post_id_fkey' AND conrelid = 'public.post_media'::regclass) THEN
    ALTER TABLE public.post_media ADD CONSTRAINT post_media_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_media_media_type_check' AND conrelid = 'public.post_media'::regclass) THEN
    ALTER TABLE public.post_media ADD CONSTRAINT post_media_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text])));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_post_media_post_display ON public.post_media USING btree (post_id, display_order);
CREATE INDEX IF NOT EXISTS idx_post_media_post_id ON public.post_media USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_post_media_post_order ON public.post_media USING btree (post_id, display_order);

ALTER TABLE public.post_media ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.post_media TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_media' AND policyname = 'post_media_delete_policy') THEN
    CREATE POLICY post_media_delete_policy ON public.post_media FOR DELETE
      USING (EXISTS ( SELECT 1
         FROM posts
        WHERE ((posts.id = post_media.post_id) AND (posts.profile_id = ( SELECT auth.uid() AS uid)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_media' AND policyname = 'post_media_insert_policy') THEN
    CREATE POLICY post_media_insert_policy ON public.post_media FOR INSERT
      WITH CHECK (EXISTS ( SELECT 1
         FROM posts
        WHERE ((posts.id = post_media.post_id) AND (posts.profile_id = ( SELECT auth.uid() AS uid)))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_media' AND policyname = 'post_media_profile_access_select') THEN
    CREATE POLICY post_media_profile_access_select ON public.post_media FOR SELECT
      USING (EXISTS ( SELECT 1
         FROM posts p
        WHERE ((p.id = post_media.post_id) AND has_profile_access(p.profile_id, ARRAY['guardian'::text, 'supervised'::text, 'viewer'::text]))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_media' AND policyname = 'post_media_select_policy') THEN
    CREATE POLICY post_media_select_policy ON public.post_media FOR SELECT
      USING (EXISTS ( SELECT 1
         FROM posts
        WHERE ((posts.id = post_media.post_id) AND ((posts.profile_id = ( SELECT auth.uid() AS uid)) OR (posts.visibility = 'public'::text) OR (EXISTS ( SELECT 1
                 FROM follows
                WHERE ((follows.follower_id = ( SELECT auth.uid() AS uid)) AND (follows.following_id = posts.profile_id) AND (follows.status = 'accepted'::text))))))));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_media' AND policyname = 'post_media_update_policy') THEN
    CREATE POLICY post_media_update_policy ON public.post_media FOR UPDATE
      USING (EXISTS ( SELECT 1
         FROM posts
        WHERE ((posts.id = post_media.post_id) AND (posts.profile_id = ( SELECT auth.uid() AS uid)))));
  END IF;
END $$;

-- ── post_likes — live: 4 columns · 4 constraints · 5 indexes · 3 policies · 3 triggers
CREATE TABLE IF NOT EXISTS public.post_likes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT post_likes_pkey PRIMARY KEY (id),
  CONSTRAINT post_likes_post_id_profile_id_key UNIQUE (post_id, profile_id),
  CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT post_likes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- An existing table gets every column here (no numbered file ALTERs it).
ALTER TABLE public.post_likes
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS post_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_pkey' AND conrelid = 'public.post_likes'::regclass) THEN
    ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_post_id_profile_id_key' AND conrelid = 'public.post_likes'::regclass) THEN
    ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_post_id_profile_id_key UNIQUE (post_id, profile_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_post_id_fkey' AND conrelid = 'public.post_likes'::regclass) THEN
    ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_profile_id_fkey' AND conrelid = 'public.post_likes'::regclass) THEN
    ALTER TABLE public.post_likes ADD CONSTRAINT post_likes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_post_likes_post ON public.post_likes USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON public.post_likes USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_post_likes_profile ON public.post_likes USING btree (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_likes_profile_id ON public.post_likes USING btree (profile_id);

ALTER TABLE public.post_likes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.post_likes TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_likes' AND policyname = 'post_likes_delete_policy') THEN
    CREATE POLICY post_likes_delete_policy ON public.post_likes FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_likes' AND policyname = 'post_likes_insert_policy') THEN
    CREATE POLICY post_likes_insert_policy ON public.post_likes FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_likes' AND policyname = 'post_likes_select_policy') THEN
    CREATE POLICY post_likes_select_policy ON public.post_likes FOR SELECT
      USING (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_notify_post_like ON public.post_likes;
CREATE TRIGGER trigger_notify_post_like AFTER INSERT ON public.post_likes FOR EACH ROW EXECUTE FUNCTION notify_post_like();
DROP TRIGGER IF EXISTS trigger_update_post_likes_count ON public.post_likes;
CREATE TRIGGER trigger_update_post_likes_count AFTER INSERT OR DELETE ON public.post_likes FOR EACH ROW EXECUTE FUNCTION update_post_likes_count();
DROP TRIGGER IF EXISTS update_post_likes_count_trigger ON public.post_likes;
CREATE TRIGGER update_post_likes_count_trigger AFTER INSERT OR DELETE ON public.post_likes FOR EACH ROW EXECUTE FUNCTION update_post_likes_count();

-- ── post_comments — live: 15 columns · 6 constraints · 9 indexes · 4 policies · 3 triggers
CREATE TABLE IF NOT EXISTS public.post_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  parent_comment_id uuid,
  content text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  likes_count integer DEFAULT 0,
  gif_url text,
  is_pinned boolean DEFAULT false,
  mentions uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_by_user_id uuid,
  status text NOT NULL DEFAULT 'published'::text,
  review_note text,
  approval_nudged_at timestamp with time zone,
  CONSTRAINT post_comments_pkey PRIMARY KEY (id),
  CONSTRAINT post_comments_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT post_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES post_comments(id) ON DELETE CASCADE,
  CONSTRAINT post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT post_comments_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
  CONSTRAINT post_comments_status_check CHECK ((status = ANY (ARRAY['published'::text, 'pending_approval'::text, 'rejected'::text, 'changes_requested'::text])))
);

-- An existing table gets the columns no numbered file adds (the chain
-- ALTERs the other 7 in 013, 016, 073, 093, 095, 129).
ALTER TABLE public.post_comments
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS post_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS parent_comment_id uuid,
  ADD COLUMN IF NOT EXISTS content text,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now(),
  ADD COLUMN IF NOT EXISTS likes_count integer DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_pkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_created_by_user_id_fkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_parent_comment_id_fkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_parent_comment_id_fkey FOREIGN KEY (parent_comment_id) REFERENCES post_comments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_post_id_fkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_profile_id_fkey' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_comments_status_check' AND conrelid = 'public.post_comments'::regclass) THEN
    ALTER TABLE public.post_comments ADD CONSTRAINT post_comments_status_check CHECK ((status = ANY (ARRAY['published'::text, 'pending_approval'::text, 'rejected'::text, 'changes_requested'::text])));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comments_created_by ON public.post_comments USING btree (created_by_user_id) WHERE (created_by_user_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_comments_post ON public.post_comments USING btree (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_created ON public.post_comments USING btree (post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_comments_is_pinned ON public.post_comments USING btree (post_id) WHERE (is_pinned = true);
CREATE INDEX IF NOT EXISTS idx_post_comments_parent_comment_id ON public.post_comments USING btree (parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_pending_nudge ON public.post_comments USING btree (created_at) WHERE ((status = 'pending_approval'::text) AND (approval_nudged_at IS NULL));
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON public.post_comments USING btree (post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_profile_id ON public.post_comments USING btree (profile_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_status_pending ON public.post_comments USING btree (profile_id) WHERE (status <> 'published'::text);

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.post_comments TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_comments' AND policyname = 'post_comments_delete_policy') THEN
    CREATE POLICY post_comments_delete_policy ON public.post_comments FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_comments' AND policyname = 'post_comments_insert_policy') THEN
    CREATE POLICY post_comments_insert_policy ON public.post_comments FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_comments' AND policyname = 'post_comments_select_policy') THEN
    CREATE POLICY post_comments_select_policy ON public.post_comments FOR SELECT
      USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_comments' AND policyname = 'post_comments_update_policy') THEN
    CREATE POLICY post_comments_update_policy ON public.post_comments FOR UPDATE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_notify_post_comment ON public.post_comments;
CREATE TRIGGER trigger_notify_post_comment AFTER INSERT ON public.post_comments FOR EACH ROW EXECUTE FUNCTION notify_post_comment();
DROP TRIGGER IF EXISTS trigger_update_post_comments_count ON public.post_comments;
CREATE TRIGGER trigger_update_post_comments_count AFTER INSERT OR DELETE OR UPDATE OF status ON public.post_comments FOR EACH ROW EXECUTE FUNCTION update_post_comments_count();
DROP TRIGGER IF EXISTS update_post_comments_count_trigger ON public.post_comments;
CREATE TRIGGER update_post_comments_count_trigger AFTER INSERT OR DELETE ON public.post_comments FOR EACH ROW EXECUTE FUNCTION update_post_comments_count();

-- ── comment_likes — live: 4 columns · 4 constraints · 2 indexes · 3 policies · 3 triggers
CREATE TABLE IF NOT EXISTS public.comment_likes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL,
  profile_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT comment_likes_pkey PRIMARY KEY (id),
  CONSTRAINT comment_likes_comment_id_profile_id_key UNIQUE (comment_id, profile_id),
  CONSTRAINT comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE,
  CONSTRAINT comment_likes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- An existing table gets every column here (no numbered file ALTERs it).
ALTER TABLE public.comment_likes
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS comment_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS profile_id uuid NOT NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_pkey' AND conrelid = 'public.comment_likes'::regclass) THEN
    ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_pkey PRIMARY KEY (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_comment_id_profile_id_key' AND conrelid = 'public.comment_likes'::regclass) THEN
    ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_comment_id_profile_id_key UNIQUE (comment_id, profile_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_comment_id_fkey' AND conrelid = 'public.comment_likes'::regclass) THEN
    ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES post_comments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comment_likes_profile_id_fkey' AND conrelid = 'public.comment_likes'::regclass) THEN
    ALTER TABLE public.comment_likes ADD CONSTRAINT comment_likes_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_comment_likes_profile ON public.comment_likes USING btree (profile_id, created_at DESC);

ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public.comment_likes TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_likes' AND policyname = 'comment_likes_delete_policy') THEN
    CREATE POLICY comment_likes_delete_policy ON public.comment_likes FOR DELETE
      USING (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_likes' AND policyname = 'comment_likes_insert_policy') THEN
    CREATE POLICY comment_likes_insert_policy ON public.comment_likes FOR INSERT
      WITH CHECK (profile_id = ( SELECT auth.uid() AS uid));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_likes' AND policyname = 'comment_likes_select_policy') THEN
    CREATE POLICY comment_likes_select_policy ON public.comment_likes FOR SELECT
      USING (true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trigger_decrement_comment_likes_count ON public.comment_likes;
CREATE TRIGGER trigger_decrement_comment_likes_count AFTER DELETE ON public.comment_likes FOR EACH ROW EXECUTE FUNCTION decrement_comment_likes_count();
DROP TRIGGER IF EXISTS trigger_increment_comment_likes_count ON public.comment_likes;
CREATE TRIGGER trigger_increment_comment_likes_count AFTER INSERT ON public.comment_likes FOR EACH ROW EXECUTE FUNCTION increment_comment_likes_count();
DROP TRIGGER IF EXISTS trigger_notify_comment_like ON public.comment_likes;
CREATE TRIGGER trigger_notify_comment_like AFTER INSERT ON public.comment_likes FOR EACH ROW EXECUTE FUNCTION notify_comment_like();

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run; every row OK) ──────────────────
SELECT 'follows: columns' AS check_name, '7' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'follows'

UNION ALL

SELECT 'follows: constraints', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.follows'::regclass

UNION ALL

SELECT 'follows: indexes', '7', count(*)::text,
       CASE WHEN count(*) = 7 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'follows'

UNION ALL

SELECT 'follows: policies', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'follows'

UNION ALL

SELECT 'follows: triggers', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.follows'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'follows: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.follows'::regclass

UNION ALL

SELECT 'posts: columns' AS check_name, '29' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 29 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts'

UNION ALL

SELECT 'posts: constraints', '11', count(*)::text,
       CASE WHEN count(*) = 11 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.posts'::regclass

UNION ALL

SELECT 'posts: indexes', '20', count(*)::text,
       CASE WHEN count(*) = 20 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'posts'

UNION ALL

SELECT 'posts: policies', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'posts'

UNION ALL

SELECT 'posts: triggers', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.posts'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'posts: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.posts'::regclass

UNION ALL

SELECT 'post_media: columns' AS check_name, '12' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 12 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'post_media'

UNION ALL

SELECT 'post_media: constraints', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.post_media'::regclass

UNION ALL

SELECT 'post_media: indexes', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'post_media'

UNION ALL

SELECT 'post_media: policies', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_media'

UNION ALL

SELECT 'post_media: triggers', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_media'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'post_media: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.post_media'::regclass

UNION ALL

SELECT 'post_likes: columns' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'post_likes'

UNION ALL

SELECT 'post_likes: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.post_likes'::regclass

UNION ALL

SELECT 'post_likes: indexes', '5', count(*)::text,
       CASE WHEN count(*) = 5 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'post_likes'

UNION ALL

SELECT 'post_likes: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_likes'

UNION ALL

SELECT 'post_likes: triggers', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_likes'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'post_likes: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.post_likes'::regclass

UNION ALL

SELECT 'post_comments: columns' AS check_name, '15' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 15 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'post_comments'

UNION ALL

SELECT 'post_comments: constraints', '6', count(*)::text,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.post_comments'::regclass

UNION ALL

SELECT 'post_comments: indexes', '9', count(*)::text,
       CASE WHEN count(*) = 9 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'post_comments'

UNION ALL

SELECT 'post_comments: policies', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_comments'

UNION ALL

SELECT 'post_comments: triggers', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.post_comments'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'post_comments: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.post_comments'::regclass

UNION ALL

SELECT 'comment_likes: columns' AS check_name, '4' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'comment_likes'

UNION ALL

SELECT 'comment_likes: constraints', '4', count(*)::text,
       CASE WHEN count(*) = 4 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.comment_likes'::regclass

UNION ALL

SELECT 'comment_likes: indexes', '2', count(*)::text,
       CASE WHEN count(*) = 2 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'comment_likes'

UNION ALL

SELECT 'comment_likes: policies', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_policies WHERE schemaname = 'public' AND tablename = 'comment_likes'

UNION ALL

SELECT 'comment_likes: triggers', '3', count(*)::text,
       CASE WHEN count(*) = 3 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_trigger WHERE tgrelid = 'public.comment_likes'::regclass AND NOT tgisinternal

UNION ALL

SELECT 'comment_likes: rls', 'true', relrowsecurity::text,
       CASE WHEN relrowsecurity THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_class WHERE oid = 'public.comment_likes'::regclass

ORDER BY 1;
