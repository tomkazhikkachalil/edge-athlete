-- ============================================================================
-- 322: an indoor golf round's putting rule (Nov 27 2026).
--      Runs on BOTH staging and prod BEFORE the code deploys: the new app
--      selects and writes the columns.
-- ============================================================================
-- Tom's indoor course spec (Nov 27 2026): a simulator round says how putts
-- are handled for the whole round, chosen on the round's Course step:
--   putt_out  every putt is played and counted (an outdoor round's rule)
--   gimme     a ball that stops inside N feet is holed for 1 putt
--   auto_2    any ball on the green is holed for 2 putts
--
-- WHAT, on public.golf_scorecard_data (the live round's setup row, written
-- once by POST /api/group-posts) AND on public.golf_rounds (the finished
-- round, copied by mirrorCompletedRound) — the same two nullable columns:
--   putting_rule  text      'putt_out' | 'gimme' | 'auto_2'
--   gimme_feet    smallint  1–15, set exactly when the rule is 'gimme'
--
-- INDOOR ONLY: a CHECK refuses a rule on a round that is not indoor. NULL on
-- an indoor round (every round made before today, an organisation's event
-- round) READS as putt_out (src/lib/golf/putting-rule.ts puttingRuleOf) —
-- nothing is backfilled.
--
-- SETUP ONLY for now: the scoring card does not read the rule yet. It is
-- stored so the card can use it when that is designed.
--
-- No index (never filtered on). No grant change: a column on an existing
-- table inherits the table's grants and RLS.
--
-- PRE-FLIGHT (expect: 0 rows):
--   SELECT table_name, column_name FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name IN ('golf_scorecard_data', 'golf_rounds')
--     AND column_name IN ('putting_rule', 'gimme_feet');
--
-- Idempotent. Run in the Supabase SQL editor as a single execution.
-- ============================================================================

ALTER TABLE public.golf_scorecard_data
  ADD COLUMN IF NOT EXISTS putting_rule text,
  ADD COLUMN IF NOT EXISTS gimme_feet smallint;

ALTER TABLE public.golf_rounds
  ADD COLUMN IF NOT EXISTS putting_rule text,
  ADD COLUMN IF NOT EXISTS gimme_feet smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_putting_rule_check' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_putting_rule_check
      CHECK (putting_rule IS NULL OR putting_rule IN ('putt_out', 'gimme', 'auto_2'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_putting_indoor_check' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_putting_indoor_check
      CHECK (putting_rule IS NULL OR round_type = 'indoor');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_gimme_feet_check' AND conrelid = 'public.golf_scorecard_data'::regclass) THEN
    ALTER TABLE public.golf_scorecard_data ADD CONSTRAINT golf_scorecard_data_gimme_feet_check
      CHECK ((gimme_feet IS NULL AND putting_rule IS DISTINCT FROM 'gimme')
          OR (putting_rule = 'gimme' AND gimme_feet BETWEEN 1 AND 15));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_putting_rule_check' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_putting_rule_check
      CHECK (putting_rule IS NULL OR putting_rule IN ('putt_out', 'gimme', 'auto_2'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_putting_indoor_check' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_putting_indoor_check
      CHECK (putting_rule IS NULL OR round_type = 'indoor');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_rounds_gimme_feet_check' AND conrelid = 'public.golf_rounds'::regclass) THEN
    ALTER TABLE public.golf_rounds ADD CONSTRAINT golf_rounds_gimme_feet_check
      CHECK ((gimme_feet IS NULL AND putting_rule IS DISTINCT FROM 'gimme')
          OR (putting_rule = 'gimme' AND gimme_feet BETWEEN 1 AND 15));
  END IF;
END $$;

COMMENT ON COLUMN public.golf_scorecard_data.putting_rule IS 'An INDOOR round''s putting rule (322): putt_out | gimme | auto_2. NULL on an indoor round reads as putt_out; always NULL outdoors.';
COMMENT ON COLUMN public.golf_scorecard_data.gimme_feet IS 'The gimme distance in feet, 1–15 (322): set exactly when putting_rule is gimme.';
COMMENT ON COLUMN public.golf_rounds.putting_rule IS 'The finished round''s copy of golf_scorecard_data.putting_rule (322), written by mirrorCompletedRound.';
COMMENT ON COLUMN public.golf_rounds.gimme_feet IS 'The finished round''s copy of golf_scorecard_data.gimme_feet (322).';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (322, '322_golf_putting_rule.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 322 APPLIED | 4 | 6 | 322
SELECT '322 APPLIED' AS result,
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('golf_scorecard_data', 'golf_rounds')
      AND column_name IN ('putting_rule', 'gimme_feet')) AS columns_expect_4,
  (SELECT count(*) FROM pg_constraint
    WHERE conrelid IN ('public.golf_scorecard_data'::regclass, 'public.golf_rounds'::regclass)
      AND conname IN ('golf_scorecard_data_putting_rule_check', 'golf_scorecard_data_putting_indoor_check', 'golf_scorecard_data_gimme_feet_check',
                      'golf_rounds_putting_rule_check', 'golf_rounds_putting_indoor_check', 'golf_rounds_gimme_feet_check')) AS constraints_expect_6,
  (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_322;
