-- verify-277-counters.sql — the ±1 triggers walk a like and a comment through
-- their states inside ONE transaction and roll back: nothing is left behind.
-- Expected (staging and production): every observed count equals the expected one.
BEGIN;
CREATE TEMP TABLE walk (step text, expected int, observed int);
DO $$
DECLARE p uuid; u uuid; c uuid;
BEGIN
  SELECT id, profile_id INTO p, u FROM public.posts WHERE visibility = 'public' AND status = 'published' ORDER BY created_at DESC LIMIT 1;
  UPDATE public.posts SET likes_count = (SELECT count(*) FROM public.post_likes WHERE post_id = p),
                          comments_count = (SELECT count(*) FROM public.post_comments WHERE post_id = p AND status = 'published') WHERE id = p;
  -- like, unlike
  INSERT INTO public.post_likes (post_id, profile_id) VALUES (p, u) ON CONFLICT DO NOTHING;
  INSERT INTO walk SELECT 'like → likes_count', (SELECT count(*) FROM public.post_likes WHERE post_id = p), likes_count FROM public.posts WHERE id = p;
  DELETE FROM public.post_likes WHERE post_id = p AND profile_id = u;
  INSERT INTO walk SELECT 'unlike → likes_count', (SELECT count(*) FROM public.post_likes WHERE post_id = p), likes_count FROM public.posts WHERE id = p;
  -- a held comment does not count; approving it does; a comment like counts; deleting un-counts
  INSERT INTO public.post_comments (post_id, profile_id, content, status) VALUES (p, u, 'verify-277', 'pending_approval') RETURNING id INTO c;
  INSERT INTO walk SELECT 'held comment → comments_count', (SELECT count(*) FROM public.post_comments WHERE post_id = p AND status = 'published'), comments_count FROM public.posts WHERE id = p;
  UPDATE public.post_comments SET status = 'published' WHERE id = c;
  INSERT INTO walk SELECT 'approved → comments_count', (SELECT count(*) FROM public.post_comments WHERE post_id = p AND status = 'published'), comments_count FROM public.posts WHERE id = p;
  INSERT INTO public.comment_likes (comment_id, profile_id) VALUES (c, u);
  INSERT INTO walk SELECT 'comment like → likes_count', 1, likes_count FROM public.post_comments WHERE id = c;
  DELETE FROM public.comment_likes WHERE comment_id = c AND profile_id = u;
  INSERT INTO walk SELECT 'comment unlike → likes_count', 0, likes_count FROM public.post_comments WHERE id = c;
  UPDATE public.post_comments SET status = 'rejected' WHERE id = c;
  INSERT INTO walk SELECT 'rejected → comments_count', (SELECT count(*) FROM public.post_comments WHERE post_id = p AND status = 'published'), comments_count FROM public.posts WHERE id = p;
  DELETE FROM public.post_comments WHERE id = c;
  INSERT INTO walk SELECT 'deleted → comments_count', (SELECT count(*) FROM public.post_comments WHERE post_id = p AND status = 'published'), comments_count FROM public.posts WHERE id = p;
END $$;
SELECT step, expected, observed, (expected = observed) AS ok FROM walk;
ROLLBACK;
