-- ============================================================================
-- 192: golf_rounds — the six condition columns the chain never named
--      (data foundation, P4 — Sep 14 2026)
-- ============================================================================
-- 002 created golf_rounds; two loose files under database/features/golf/
-- (add-golf-round-conditions.sql, add-flexible-golf-rounds.sql) then added
-- weather, temperature, wind, course_rating, slope_rating and round_type,
-- dropped 002's `holes IN (9, 18)` CHECK, and were never numbered.
-- course_rating and slope_rating are LOAD-BEARING: the WHS handicap engine
-- (src/lib/golf/handicap-server.ts) computes a differential only when a
-- round carries both. This file records the six from the Sep 14 2026 dump
-- (database/provenance/dumps/2026-09-14-live-dump.csv) — a NO-OP on
-- production, drops nothing, re-runnable — and the allowlist forgets them.
--
-- Recorded as found:
--   * course_rating is numeric(4,1) (the loose file's DECIMAL(4,1)); the
--     percentages 002 declared are numeric(5,2). temperature is an integer
--     in Fahrenheit (the loose file's comment, ported below).
--   * golf_rounds_holes_check is ABSENT live (grid 2) — flexible hole counts
--     (5, 12, 15 …) are a product decision the loose file made and the app
--     relies on; the DROP below is the record of it, a no-op today.
--   * round_type's CHECK exists live under the auto-generated name
--     golf_rounds_round_type_check; the column is nullable with DEFAULT
--     'outdoor' (the loose file's data UPDATE is NOT repeated — a baseline
--     writes no rows).
--   * The loose file also named an index idx_golf_rounds_round_type; it does
--     NOT exist live (grid 3 lists seven golf_rounds indexes, all owned by
--     the chain), so it is not created here — a baseline records, it does
--     not improve. A later migration may add it when a reader needs it.
--   * The column COMMENTs the loose files set are ported (metadata only).
-- ============================================================================

ALTER TABLE public.golf_rounds
  ADD COLUMN IF NOT EXISTS weather text,
  ADD COLUMN IF NOT EXISTS temperature integer,
  ADD COLUMN IF NOT EXISTS wind text,
  ADD COLUMN IF NOT EXISTS course_rating numeric(4,1),
  ADD COLUMN IF NOT EXISTS slope_rating integer,
  ADD COLUMN IF NOT EXISTS round_type text DEFAULT 'outdoor'::text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_round_type_check' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_round_type_check CHECK ((round_type = ANY (ARRAY['outdoor'::text, 'indoor'::text])));
  END IF;
END $$;

-- 002's CHECK (holes IN (9, 18)) was dropped live by the flexible-rounds
-- file; absent on production (grid 2). Recorded here so the chain says so.
ALTER TABLE public.golf_rounds DROP CONSTRAINT IF EXISTS golf_rounds_holes_check;

COMMENT ON COLUMN public.golf_rounds.weather IS 'Weather conditions during the round (e.g., Sunny, Cloudy, Rainy)';
COMMENT ON COLUMN public.golf_rounds.temperature IS 'Temperature in Fahrenheit during the round';
COMMENT ON COLUMN public.golf_rounds.wind IS 'Wind conditions during the round (e.g., Calm, Light Breeze, Windy)';
COMMENT ON COLUMN public.golf_rounds.course_rating IS 'USGA Course Rating (difficulty for scratch golfer)';
COMMENT ON COLUMN public.golf_rounds.slope_rating IS 'USGA Slope Rating (relative difficulty, 55-155)';
COMMENT ON COLUMN public.golf_rounds.round_type IS 'Type of round: outdoor (default) or indoor (simulator/range)';
COMMENT ON COLUMN public.golf_rounds.holes IS 'Number of holes played - can be any positive integer (commonly 9 or 18, but supports partial rounds like 5, 12, 15, etc.)';

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT 'golf_rounds: the six columns' AS check_name, '6' AS expected, count(*)::text AS actual,
       CASE WHEN count(*) = 6 THEN 'OK' ELSE 'CHECK FAILED' END AS status
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'golf_rounds'
   AND column_name IN ('weather', 'temperature', 'wind', 'course_rating', 'slope_rating', 'round_type')

UNION ALL

SELECT 'golf_rounds: course_rating precision', 'numeric(4,1)',
       format_type(atttypid, atttypmod),
       CASE WHEN format_type(atttypid, atttypmod) = 'numeric(4,1)' THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_attribute WHERE attrelid = 'public.golf_rounds'::regclass AND attname = 'course_rating'

UNION ALL

SELECT 'golf_rounds: round_type CHECK', '1', count(*)::text,
       CASE WHEN count(*) = 1 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.golf_rounds'::regclass AND conname = 'golf_rounds_round_type_check'

UNION ALL

SELECT 'golf_rounds: holes CHECK gone', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint WHERE conrelid = 'public.golf_rounds'::regclass AND conname = 'golf_rounds_holes_check'

UNION ALL

SELECT 'golf_rounds: columns', '24', count(*)::text,
       CASE WHEN count(*) = 24 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_rounds'

ORDER BY 1;
