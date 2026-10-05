-- ============================================================================
-- 252: post impact — views and video plays, counted once per person per day
--      (likes PR 2, Oct 4 2026; runs on BOTH staging and prod; additive)
-- ============================================================================
-- Tom: "if anyone interacts with your posts, but they don't like or comment on
-- it, I want there to be an 'impact' so you know that 1000 ppl viewed your
-- post or watched your video." Decisions: EVERYONE sees the numbers; a view
-- counts ONCE per person per post per day (a hashed daily mark — never who,
-- the 188 org-site analytics rule); a video counts a play after 3 s of
-- playback, once per person per day; the owner's own views never count.
--
--   1. posts.views_count / posts.plays_count — the cached totals every reader
--      already selects with `*` (so the code may ship before this ran: an
--      absent column is simply undefined on the wire).
--   2. post_view_marks (post_id, day, kind, viewer_hash) — the day's unique
--      marks; the hash is sha256(HMAC(salt, day) ‖ viewer), unlinkable across
--      days; the daily cron prunes marks older than 2 days. No cookie, no IP,
--      no user agent, no user id is ever stored. Posture A.
--   3. bump_post_views(day, items) — ONE round trip per beacon: for each
--      {id, kind, hash} insert the mark (on conflict nothing → new?) and,
--      when new, bump the post's counter — PUBLISHED posts only. SECURITY
--      DEFINER, EXECUTE for service_role only (the RPC grants rule).
--   4. Comment likes defense (likes PR 1 recounts in the route): the +1 / −1
--      trigger functions now RECOUNT (015's shape for post_comments), and
--      every stored like count is recounted once here.
--
-- Pre-flight: ledger head 251. Deploy order: FLEXIBLE — the beacon route
-- swallows a missing function; the cards read undefined as "no count".
-- Reversal (data-safe): DROP FUNCTION bump_post_views; DROP TABLE
-- post_view_marks; DROP the two columns; re-declare the comment-like
-- functions as 190 recorded them.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 252) THEN
    RAISE EXCEPTION '252 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 251 THEN RAISE EXCEPTION '252 pre-flight: ledger head is %, expected 251', n; END IF;
END $$;

-- ── 1. The cached totals ────────────────────────────────────────────────────
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS views_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS plays_count integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.posts.views_count IS 'Impact (252): people who saw this post, one per person per day (a hashed daily mark in post_view_marks — never who). Shown to everyone. The owner''s own views never count.';
COMMENT ON COLUMN public.posts.plays_count IS 'Impact (252): people who played this post''s video for 3 s or more, one per person per day.';

-- ── 2. The day's marks (posture A) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.post_view_marks (
  post_id      uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  day          date NOT NULL,
  kind         text NOT NULL CONSTRAINT post_view_marks_kind_check CHECK (kind IN ('view', 'play')),
  viewer_hash  text NOT NULL CONSTRAINT post_view_marks_hash_check CHECK (length(viewer_hash) BETWEEN 16 AND 64),
  PRIMARY KEY (post_id, day, kind, viewer_hash)
);
CREATE INDEX IF NOT EXISTS idx_post_view_marks_day ON public.post_view_marks (day);
ALTER TABLE public.post_view_marks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.post_view_marks FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.post_view_marks TO service_role;
COMMENT ON TABLE public.post_view_marks IS 'Impact (252): one row per (post, UTC day, kind, hashed viewer) — the uniqueness behind "once per person per day". The hash is sha256(HMAC(salt, day) || viewer), unlinkable across days; pruned after 2 days by the daily cron. Posture A: service role only.';

-- ── 3. The bump, one round trip per beacon ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.bump_post_views(p_day date, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_post uuid;
  v_kind text;
  v_hash text;
  v_bumped integer := 0;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN RETURN 0; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LIMIT 50 LOOP
    v_kind := v_item->>'kind';
    v_hash := v_item->>'hash';
    IF v_kind NOT IN ('view', 'play') OR v_hash IS NULL OR length(v_hash) < 16 THEN CONTINUE; END IF;
    BEGIN
      v_post := (v_item->>'id')::uuid;
    EXCEPTION WHEN OTHERS THEN CONTINUE;
    END;
    -- Published posts only — a hidden or deleted post gathers no impact.
    IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id = v_post AND status = 'published') THEN CONTINUE; END IF;
    INSERT INTO public.post_view_marks (post_id, day, kind, viewer_hash)
    VALUES (v_post, p_day, v_kind, v_hash)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN
      IF v_kind = 'view' THEN
        UPDATE public.posts SET views_count = views_count + 1 WHERE id = v_post;
      ELSE
        UPDATE public.posts SET plays_count = plays_count + 1 WHERE id = v_post;
      END IF;
      v_bumped := v_bumped + 1;
    END IF;
  END LOOP;
  RETURN v_bumped;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.bump_post_views(date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bump_post_views(date, jsonb) TO service_role;

-- ── 4. Comment likes: the triggers recount (defense; the route recounts too) ─
CREATE OR REPLACE FUNCTION public.increment_comment_likes_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.post_comments
  SET likes_count = (SELECT COUNT(*) FROM public.comment_likes WHERE comment_id = NEW.comment_id)
  WHERE id = NEW.comment_id;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.decrement_comment_likes_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.post_comments
  SET likes_count = (SELECT COUNT(*) FROM public.comment_likes WHERE comment_id = OLD.comment_id)
  WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$$;
-- One recount of every stored like count (a drifted number is corrected once).
UPDATE public.post_comments c SET likes_count = l.n
FROM (SELECT comment_id, count(*) AS n FROM public.comment_likes GROUP BY comment_id) l
WHERE l.comment_id = c.id AND c.likes_count <> l.n;
UPDATE public.post_comments SET likes_count = 0
WHERE likes_count <> 0 AND NOT EXISTS (SELECT 1 FROM public.comment_likes WHERE comment_id = post_comments.id);
UPDATE public.posts p SET likes_count = l.n
FROM (SELECT post_id, count(*) AS n FROM public.post_likes GROUP BY post_id) l
WHERE l.post_id = p.id AND p.likes_count <> l.n;
UPDATE public.posts SET likes_count = 0
WHERE likes_count <> 0 AND NOT EXISTS (SELECT 1 FROM public.post_likes WHERE post_id = posts.id);

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (252, '252_post_views.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected on both environments: 252 APPLIED | 2 | 1 | 1 | 0 | 252
SELECT '252 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts'
         AND column_name IN ('views_count', 'plays_count')) AS new_columns_expect_2,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'post_view_marks') AS marks_table_expect_1,
       (SELECT count(*) FROM pg_proc WHERE proname = 'bump_post_views') AS rpc_expect_1,
       (SELECT count(*) FROM public.post_comments c
         WHERE likes_count <> (SELECT count(*) FROM public.comment_likes WHERE comment_id = c.id)) AS drifted_comment_counts_expect_0,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_252;
