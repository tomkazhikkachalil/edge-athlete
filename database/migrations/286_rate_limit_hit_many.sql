-- 286 — one limiter trip per write (the leftovers program PR 1, Oct 28 2026 —
-- docs/SCALE_AUDIT.md §7: every authenticated write paid TWO rate_limit_hit
-- round trips — requireAuth's inline `write-general` (shadow) and the
-- route's own bucket — at ~150 ms each on the function→database path).
--
--   rate_limit_hit_many(keys[], max[], window_seconds[])
--     → one row per key: (key, allowed, retry_after_seconds)
--
-- Several buckets in ONE call. Each key goes through 094's rate_limit_hit
-- itself — the same atomic fixed-window upsert, the same 1 % GC, the same
-- "no punishment extension" — so a bucket's behaviour is identical whether
-- it is checked alone or alongside another; only the round trips change.
-- The arrays are walked in order (write-general first, then the route's
-- bucket, as the callers send them), so two concurrent callers lock the
-- rows in the same order. rate_limit_hit stays for its single-key callers.
--
-- SECURITY INVOKER (the caller is the service role, which may already write
-- rate_limits; no privilege is lent), search_path pinned, EXECUTE for
-- service_role only. Deploy order: MIGRATION FIRST (a pure addition; the
-- limiter fails OPEN on a missing function as it always has — one Sentry
-- line per ten minutes, the request proceeds). Reversal: DROP FUNCTION.

CREATE OR REPLACE FUNCTION public.rate_limit_hit_many(
  p_keys text[],
  p_max integer[],
  p_window_seconds integer[]
)
RETURNS TABLE(key text, allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  i integer;
  v_allowed boolean;
  v_retry integer;
BEGIN
  IF p_keys IS NULL OR array_length(p_keys, 1) IS NULL THEN
    RETURN;
  END IF;
  IF array_length(p_max, 1) IS DISTINCT FROM array_length(p_keys, 1)
     OR array_length(p_window_seconds, 1) IS DISTINCT FROM array_length(p_keys, 1) THEN
    RAISE EXCEPTION 'rate_limit_hit_many: the three arrays must have the same length';
  END IF;
  FOR i IN 1 .. array_length(p_keys, 1) LOOP
    SELECT h.allowed, h.retry_after_seconds INTO v_allowed, v_retry
    FROM public.rate_limit_hit(p_keys[i], p_max[i], p_window_seconds[i]) AS h;
    key := p_keys[i];
    allowed := v_allowed;
    retry_after_seconds := v_retry;
    RETURN NEXT;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rate_limit_hit_many(text[], integer[], integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit_many(text[], integer[], integer[]) TO service_role;
COMMENT ON FUNCTION public.rate_limit_hit_many(text[], integer[], integer[]) IS
  'Several rate-limit buckets in one call (286): each key through 094''s rate_limit_hit, in array order; one row per key. Service-role only — src/lib/rate-limit.ts enforceRateLimitMany is the caller.';

NOTIFY pgrst, 'reload schema';

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (286, '286_rate_limit_hit_many.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 286 APPLIED | 1 | true | 286
SELECT '286 APPLIED' AS result,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'rate_limit_hit_many') AS function_expect_1,
       ((SELECT count(*) FROM public.rate_limit_hit_many(ARRAY['probe-286:a', 'probe-286:b'], ARRAY[5, 5], ARRAY[60, 60]) WHERE allowed) = 2) AS two_keys_two_rows_allowed_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_286;
-- (the two probe keys expire from rate_limits with the 1 % GC after two days; harmless)
