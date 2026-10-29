-- ============================================================================
-- 291: where a round's conditions came from (Oct 29 2026; the weather-at-the-
--      course program's only DDL; runs on BOTH staging and prod BEFORE PR 2
--      deploys — the writers send the columns, the readers select them)
-- ============================================================================
-- Tom: "it needs to be stamped with the golf round, only make this as an
-- option for a live round." PR 1 fills the Conditions step from Open-Meteo
-- at the course and the values ride the existing columns
-- (golf_scorecard_data.weather_conditions / temperature / wind_speed at Go
-- Live; golf_rounds.weather / temperature / wind on the mirrored round). What
-- the record could not say is WHETHER the person typed them or the forecast
-- did — so the round card cannot honestly print "Forecast at tee-off".
--
-- The model (two nullable columns on each table; a row without them is
-- exactly what it was — read as typed by hand):
--   conditions_source  text   'manual' | 'forecast'; NULL = unknown (old rows,
--                             or nothing entered) — readers treat NULL as manual.
--   conditions_at      timestamptz  the forecast's observation time; NULL for
--                             manual. Written ONLY from the round create
--                             payload (shared-round-submit → group-posts) and
--                             copied to golf_rounds by mirrorCompletedRound.
--
-- REVERSAL: ALTER TABLE public.golf_scorecard_data DROP COLUMN conditions_source, DROP COLUMN conditions_at;
--           ALTER TABLE public.golf_rounds          DROP COLUMN conditions_source, DROP COLUMN conditions_at;
-- Re-runnable until the ledger row lands; a second run stops in the pre-flight.
-- No new table: the Data API grants of both tables already cover new columns.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 291) THEN
    RAISE EXCEPTION '291 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 290 THEN RAISE EXCEPTION '291 pre-flight: ledger head is %, expected 290', n; END IF;
END $$;

-- ── 1. golf_scorecard_data: the live round's record ─────────────────────────
ALTER TABLE public.golf_scorecard_data ADD COLUMN IF NOT EXISTS conditions_source text;
ALTER TABLE public.golf_scorecard_data ADD COLUMN IF NOT EXISTS conditions_at timestamptz;
ALTER TABLE public.golf_scorecard_data DROP CONSTRAINT IF EXISTS golf_scorecard_data_conditions_source_check;
ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_conditions_source_check
  CHECK (conditions_source IS NULL OR conditions_source IN ('manual', 'forecast'));
COMMENT ON COLUMN public.golf_scorecard_data.conditions_source IS 'Where weather_conditions / temperature / wind_speed came from (291): manual = typed, forecast = Open-Meteo at the course at tee-off (the Conditions step''s button, live rounds only). NULL = unknown, read as manual.';
COMMENT ON COLUMN public.golf_scorecard_data.conditions_at IS 'The forecast''s observation time when conditions_source = forecast (291); NULL otherwise.';

-- ── 2. golf_rounds: the mirrored, finished round ────────────────────────────
ALTER TABLE public.golf_rounds ADD COLUMN IF NOT EXISTS conditions_source text;
ALTER TABLE public.golf_rounds ADD COLUMN IF NOT EXISTS conditions_at timestamptz;
ALTER TABLE public.golf_rounds DROP CONSTRAINT IF EXISTS golf_rounds_conditions_source_check;
ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_conditions_source_check
  CHECK (conditions_source IS NULL OR conditions_source IN ('manual', 'forecast'));
COMMENT ON COLUMN public.golf_rounds.conditions_source IS 'Where weather / temperature / wind came from (291), copied from the scorecard by mirrorCompletedRound: manual | forecast; NULL = unknown, read as manual.';
COMMENT ON COLUMN public.golf_rounds.conditions_at IS 'The forecast''s observation time when conditions_source = forecast (291); NULL otherwise.';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (291, '291_round_conditions_source.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 291 APPLIED | 4 | 291
SELECT '291 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name IN ('golf_scorecard_data', 'golf_rounds')
           AND column_name IN ('conditions_source', 'conditions_at')) AS cols_expect_4,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_291;
