-- 277 — the counter triggers add or subtract ONE; a nightly recount is the
-- accuracy rule (counters part b, Oct 26 2026 — post-audit refinements, item 2;
-- docs/SCALE_AUDIT.md hole 4b; Convention 32 amended).
--
-- Why: 015 / 095 / 252 recounted the WHOLE set on every like, comment and
-- comment like — `SET likes_count = (SELECT count(*) …)` inside the write's
-- statement: an O(likes) scan per heart on a popular post. Fix 4 (Oct 25)
-- removed the routes' second recount; this removes the trigger's. The
-- accuracy rule Tom set on Oct 4 ("make sure the count is accurate") moves to
-- `counters_recount()`: run once here (every drifted row corrected) and every
-- night by /api/cron/daily (src/lib/counters/recount-server.ts).
--
-- Same function names, same triggers (015, 095, 252 keep their CREATE
-- TRIGGER statements; CREATE OR REPLACE swaps the bodies). SECURITY DEFINER
-- + search_path '' as before. Status-aware for comments the way 229 is for
-- follows: only a PUBLISHED comment counts; a status change moves the count
-- by one in the right direction. GREATEST(…, 0) on every decrement.
--
-- Deploy order: FLEXIBLE (the routes read the column; whichever body runs,
-- the number is right). Reversal: re-run 015 / 095 / 252's bodies.

-- ── 1. post_likes → posts.likes_count (015's function) ──────────────────────
CREATE OR REPLACE FUNCTION public.update_post_likes_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.posts SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.posts SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- ── 2. post_comments → posts.comments_count, published only (095's function) ─
CREATE OR REPLACE FUNCTION public.update_post_comments_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_live boolean := (TG_OP <> 'INSERT') AND (OLD.status = 'published');
  new_live boolean := (TG_OP <> 'DELETE') AND (NEW.status = 'published');
BEGIN
  IF old_live AND NOT new_live THEN
    UPDATE public.posts SET comments_count = GREATEST(COALESCE(comments_count, 0) - 1, 0) WHERE id = OLD.post_id;
  ELSIF new_live AND NOT old_live THEN
    UPDATE public.posts SET comments_count = COALESCE(comments_count, 0) + 1 WHERE id = NEW.post_id;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- ── 3. comment_likes → post_comments.likes_count (252's two functions) ──────
CREATE OR REPLACE FUNCTION public.increment_comment_likes_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.post_comments SET likes_count = COALESCE(likes_count, 0) + 1 WHERE id = NEW.comment_id;
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
  UPDATE public.post_comments SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0) WHERE id = OLD.comment_id;
  RETURN OLD;
END;
$$;

-- ── 4. The accuracy rule: counters_recount() fixes every drifted row ────────
-- One statement per counter, touching only rows whose stored value differs
-- from the truth (so a nightly run on an in-sync table writes nothing).
-- SECURITY INVOKER: the caller is the service role (the cron), which may
-- already update these tables; no privilege is lent.
CREATE OR REPLACE FUNCTION public.counters_recount()
RETURNS TABLE (target text, fixed integer)
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  WITH truth AS (
    SELECT p.id, COALESCE(l.n, 0)::integer AS n
    FROM public.posts p
    LEFT JOIN (SELECT post_id, count(*) AS n FROM public.post_likes GROUP BY post_id) l ON l.post_id = p.id
    WHERE COALESCE(p.likes_count, 0) <> COALESCE(l.n, 0)
  )
  UPDATE public.posts p SET likes_count = t.n FROM truth t WHERE p.id = t.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  target := 'posts.likes_count'; fixed := n; RETURN NEXT;

  WITH truth AS (
    SELECT p.id, COALESCE(c.n, 0)::integer AS n
    FROM public.posts p
    LEFT JOIN (SELECT post_id, count(*) AS n FROM public.post_comments WHERE status = 'published' GROUP BY post_id) c ON c.post_id = p.id
    WHERE COALESCE(p.comments_count, 0) <> COALESCE(c.n, 0)
  )
  UPDATE public.posts p SET comments_count = t.n FROM truth t WHERE p.id = t.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  target := 'posts.comments_count'; fixed := n; RETURN NEXT;

  WITH truth AS (
    SELECT c.id, COALESCE(l.n, 0)::integer AS n
    FROM public.post_comments c
    LEFT JOIN (SELECT comment_id, count(*) AS n FROM public.comment_likes GROUP BY comment_id) l ON l.comment_id = c.id
    WHERE COALESCE(c.likes_count, 0) <> COALESCE(l.n, 0)
  )
  UPDATE public.post_comments c SET likes_count = t.n FROM truth t WHERE c.id = t.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  target := 'post_comments.likes_count'; fixed := n; RETURN NEXT;
  RETURN;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.counters_recount() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.counters_recount() TO service_role;
COMMENT ON FUNCTION public.counters_recount() IS
  'The accuracy rule for the three cached counters (277): corrects every row whose stored count differs from a direct count, returns how many per target. Run once by 277 and nightly by /api/cron/daily (src/lib/counters/recount-server.ts). The triggers add or subtract one.';

-- ── 5. The one-off reconciliation (every drifted row, once) ─────────────────
CREATE TEMP TABLE IF NOT EXISTS recount_277 AS SELECT * FROM public.counters_recount();

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (277, '277_counter_triggers_plus_minus.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 277 APPLIED | <small> | <small> | <small> | 5 | 277
SELECT '277 APPLIED' AS result,
       (SELECT fixed FROM recount_277 WHERE target = 'posts.likes_count') AS fixed_posts_likes,
       (SELECT fixed FROM recount_277 WHERE target = 'posts.comments_count') AS fixed_posts_comments,
       (SELECT fixed FROM recount_277 WHERE target = 'post_comments.likes_count') AS fixed_comment_likes,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
          AND p.proname IN ('update_post_likes_count', 'update_post_comments_count', 'increment_comment_likes_count', 'decrement_comment_likes_count', 'counters_recount')) AS functions_expect_5,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_277;
