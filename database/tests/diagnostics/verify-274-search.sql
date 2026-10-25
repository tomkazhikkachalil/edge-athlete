-- verify-274-search.sql — the check grid for migration 274 (search ranks on
-- stored columns, same order). Re-runnable, read-only. Each row's `ok` must be true.
SELECT 'columns present' AS check_name,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='search_documents' AND column_name IN ('title_norm','title_vector')) = 2 AS ok
UNION ALL SELECT 'every document filled',
       (SELECT count(*) FROM public.search_documents WHERE title_norm IS NULL OR title_vector IS NULL) = 0
UNION ALL SELECT 'title_norm is search_normalize(title) on every row',
       NOT EXISTS (SELECT 1 FROM public.search_documents WHERE title_norm IS DISTINCT FROM public.search_normalize(title))
UNION ALL SELECT 'title_vector is to_tsvector(simple, title_norm) on every row',
       NOT EXISTS (SELECT 1 FROM public.search_documents WHERE title_vector IS DISTINCT FROM to_tsvector('simple', public.search_normalize(title)))
UNION ALL SELECT 'the trigger exists',
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='search_documents_title_sync' AND NOT tgisinternal)
UNION ALL SELECT 'one search_all (no overload)',
       (SELECT count(*) FROM pg_proc WHERE proname='search_all') = 1
UNION ALL SELECT 'search_all is SECURITY INVOKER with search_path public, extensions',
       EXISTS (SELECT 1 FROM pg_proc p WHERE p.proname='search_all' AND NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public, extensions'])
UNION ALL SELECT 'API roles cannot EXECUTE search_all',
       NOT has_function_privilege('anon', 'public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8)', 'EXECUTE')
   AND NOT has_function_privilege('authenticated', 'public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8)', 'EXECUTE')
UNION ALL SELECT 'service_role can EXECUTE search_all',
       has_function_privilege('service_role', 'public.search_all(text, text[], int, uuid[], boolean, text, text, float8, float8, float8)', 'EXECUTE')
UNION ALL SELECT 'a prefix query answers (any corpus)',
       (SELECT count(*) FROM public.search_all('a', NULL, 20, '{}'::uuid[], true)) >= 0;
