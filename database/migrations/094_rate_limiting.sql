-- ============================================================================
-- Migration 094 — Server-side rate limiting (table + atomic hit RPC)
-- ============================================================================
-- Rate-limiting round (Aug 20 2026). The in-memory limiter in
-- src/lib/rate-limit.ts was per-lambda (limit × live instances, reset on
-- cold start) and guarded 3 routes. This gives every route a shared,
-- cross-instance counter: one row per (action:identifier) key, fixed window,
-- one atomic upsert per check.
--
-- Deploy order: FLEXIBLE. The TS caller fails open on any RPC error
-- (including PGRST202 function-not-found), so code can ship before or after
-- this runs. Run it promptly anyway — until it runs, nothing is limited.
--
-- Service-role only, like 087/091: RLS on with ZERO policies on the table,
-- EXECUTE revoked from anon/authenticated on the function. SECURITY INVOKER
-- on purpose (087's rationale): the only caller is getSupabaseAdmin(), and
-- INVOKER means a future grant slip is merely useless, not dangerous.

CREATE TABLE IF NOT EXISTS rate_limits (
  key          text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL
);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;  -- zero policies: service-role writes only (091 pattern)
REVOKE ALL ON TABLE public.rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.rate_limits TO service_role;

DROP FUNCTION IF EXISTS public.rate_limit_hit(text, integer, integer);
CREATE FUNCTION public.rate_limit_hit(
  p_key text,
  p_max integer,
  p_window_seconds integer
) RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  -- Opportunistic GC on ~1% of calls: rows are one per active key, so the
  -- table stays at hundreds of rows and this needs no cron. 2 days is
  -- comfortably past the longest window (1 day), so it only touches cold
  -- rows and never contends with a hot key's row lock.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '2 days';
  END IF;

  -- One atomic upsert: concurrent callers serialize on the row lock, so no
  -- lost increments and no double window-reset. While blocked, count keeps
  -- climbing but window_start does NOT move — the window still expires on
  -- schedule (no punishment-extension).
  INSERT INTO public.rate_limits AS rl (key, window_start, count)
  VALUES (p_key, now(), 1)
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN rl.window_start <= now() - make_interval(secs => p_window_seconds)
      THEN 1 ELSE rl.count + 1 END,
    window_start = CASE
      WHEN rl.window_start <= now() - make_interval(secs => p_window_seconds)
      THEN now() ELSE rl.window_start END
  RETURNING rl.count, rl.window_start INTO v_count, v_window_start;

  allowed := v_count <= p_max;
  retry_after_seconds := CASE WHEN v_count <= p_max THEN 0
    ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM
      (v_window_start + make_interval(secs => p_window_seconds) - now())))::integer)
  END;
  RETURN NEXT;
END;
$$;

-- Server-only: every caller goes through getSupabaseAdmin(). Revoke BEFORE
-- granting so a re-run cannot leave a window open (087 pattern; CREATE
-- grants EXECUTE to PUBLIC by default).
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text, integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.rate_limit_hit IS
  'Atomic fixed-window rate-limit check+consume. Service-role only (migration 094).';

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid (run separately if pasting mangles quotes) ────────
-- Expect: every column true.
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'rate_limits') AS table_present,
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.rate_limits'::regclass) AS rls_on,
  NOT EXISTS (SELECT 1 FROM pg_policies
          WHERE schemaname = 'public' AND tablename = 'rate_limits') AS zero_policies,
  EXISTS (SELECT 1 FROM pg_proc
          WHERE proname = 'rate_limit_hit'
            AND pronamespace = 'public'::regnamespace
            AND NOT prosecdef) AS fn_is_invoker,
  NOT has_function_privilege('anon',
      'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') AS anon_blocked,
  NOT has_function_privilege('authenticated',
      'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') AS authenticated_blocked,
  has_function_privilege('service_role',
      'public.rate_limit_hit(text,integer,integer)', 'EXECUTE') AS service_role_allowed;
