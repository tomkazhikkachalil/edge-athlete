-- verify-252-post-views.sql — the check grid for migration 252 (read-only).
-- Run after 252 on staging and prod; every row should read true.
SELECT 'views_count column' AS check_name,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'views_count') AS pass
UNION ALL
SELECT 'plays_count column',
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'posts' AND column_name = 'plays_count')
UNION ALL
SELECT 'post_view_marks table, RLS on',
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'post_view_marks' AND rowsecurity)
UNION ALL
SELECT 'post_view_marks: no policies (posture A)',
       NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'post_view_marks')
UNION ALL
SELECT 'post_view_marks: anon / authenticated hold no privilege',
       NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                   WHERE table_schema = 'public' AND table_name = 'post_view_marks' AND grantee IN ('anon', 'authenticated'))
UNION ALL
SELECT 'kind CHECK names view and play',
       (SELECT pg_get_constraintdef(oid) LIKE '%''view''%' AND pg_get_constraintdef(oid) LIKE '%''play''%'
          FROM pg_constraint WHERE conname = 'post_view_marks_kind_check')
UNION ALL
SELECT 'bump_post_views exists, SECURITY DEFINER',
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bump_post_views' AND prosecdef)
UNION ALL
SELECT 'bump_post_views: anon / authenticated cannot execute',
       NOT has_function_privilege('anon', 'public.bump_post_views(date, jsonb)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.bump_post_views(date, jsonb)', 'EXECUTE')
UNION ALL
SELECT 'comment like counts agree with comment_likes',
       NOT EXISTS (SELECT 1 FROM public.post_comments c
                   WHERE likes_count <> (SELECT count(*) FROM public.comment_likes WHERE comment_id = c.id))
UNION ALL
SELECT 'post like counts agree with post_likes',
       NOT EXISTS (SELECT 1 FROM public.posts p
                   WHERE likes_count <> (SELECT count(*) FROM public.post_likes WHERE post_id = p.id))
UNION ALL
SELECT 'ledger head is 252',
       (SELECT max(number) = 252 FROM public.schema_migrations);
