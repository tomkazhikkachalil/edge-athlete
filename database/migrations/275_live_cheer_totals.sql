-- 275 — live_cheer_totals(context_key): the six cheer counts in ONE grouped
-- query (scale fix 5, Oct 25 2026 — docs/SCALE_AUDIT.md hole 5).
--
-- Why: readCheerFeed (src/lib/play/cheers-server.ts) ran SIX `count: 'exact'`
-- head requests per poll — one per cheer key — because PostgREST cannot
-- GROUP BY; with the gate's two reads and the recent-cheers read that was
-- nine statements every 10 s per watcher of a live round. One index-only
-- pass over idx_live_cheers_context (context_key, created_at) answers all six.
-- The 5,000-row cap trap (the Play review, Sep 29 2026) is avoided the same
-- way: rows never leave the database, only the counts.
--
-- Shape: STABLE, SECURITY INVOKER (the caller is the service role, which
-- already reads live_cheers; no privilege is lent), search_path pinned,
-- EXECUTE for service_role only (the API roles have no business here —
-- /api/live/cheers is the one door and runs the context's own gate first).
-- Idempotent: CREATE OR REPLACE; grants restated.

CREATE OR REPLACE FUNCTION public.live_cheer_totals(p_context_key text)
RETURNS TABLE (cheer text, n bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.cheer, count(*)::bigint AS n
  FROM public.live_cheers c
  WHERE c.context_key = p_context_key
  GROUP BY c.cheer;
$$;
REVOKE EXECUTE ON FUNCTION public.live_cheer_totals(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_cheer_totals(text) TO service_role;
COMMENT ON FUNCTION public.live_cheer_totals(text) IS
  'The cheer counts of one live round, grouped by key, in one pass over idx_live_cheers_context (275). Called only by src/lib/play/cheers-server.ts through the service role; the route gates the context first.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (275, '275_live_cheer_totals.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 275 APPLIED | 1 | false | 275
SELECT '275 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'live_cheer_totals') AS function_expect_1,
       (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'live_cheer_totals') AS security_definer_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_275;
