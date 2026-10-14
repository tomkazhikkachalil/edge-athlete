-- ============================================================================
-- 263: sports on the profile — pinned sports lead (Oct 14 2026; the profile
--      quick fixes program's first DDL; runs on BOTH staging and prod BEFORE
--      PR 3 deploys — the skill-card reader selects the two columns)
-- ============================================================================
-- Tom's spec: "Show all of the user's sports … golf given no special
-- treatment. The user can pin the sports they want most visible. Pinned
-- sports appear first and larger, and the rest follow in a compact list …
-- Other users' profiles show the same sports in the same order, without the
-- pin controls."
--
-- The model (every column defaulted or nullable — a row without a pin is
-- exactly what it was):
--   sport_settings (076: one row per profile × sport, UNIQUE(profile_id,
--   sport_key), owner-only RLS — the row every write path already upserts:
--   onboarding, the Edit Profile picker, a sport tab, and now a played sport)
--     pinned     the fact (default false)
--     pin_order  1..n among the profile's pinned sports; NULL when unpinned.
--                CHECK ties the two; a partial UNIQUE keeps two pins off one
--                slot. The ONE writer (pins-server.ts writeSportPins) unpins
--                everything first, then writes 1..n — a swap never meets the
--                index mid-statement.
--   profiles.sport (the declared primary) is NOT an implicit pin: pins are
--   explicit, the primary merely leads the compact list.
--
-- REVERSAL: drop the index, the check and the two columns. Re-runnable until
-- the ledger row lands; a second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 263) THEN
    RAISE EXCEPTION '263 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 262 THEN RAISE EXCEPTION '263 pre-flight: ledger head is %, expected 262', n; END IF;
END $$;

-- ── 1. sport_settings: the pin ──────────────────────────────────────────────
ALTER TABLE public.sport_settings
  ADD COLUMN IF NOT EXISTS pinned    boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pin_order smallint;
ALTER TABLE public.sport_settings DROP CONSTRAINT IF EXISTS sport_settings_pin_order_check;
ALTER TABLE public.sport_settings ADD CONSTRAINT sport_settings_pin_order_check
  CHECK ((pinned AND pin_order >= 1) OR (NOT pinned AND pin_order IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS idx_sport_settings_pin_order
  ON public.sport_settings (profile_id, pin_order) WHERE pinned;
COMMENT ON COLUMN public.sport_settings.pinned IS 'The athlete pinned this sport on their profile (263): pinned sports lead, larger.';
COMMENT ON COLUMN public.sport_settings.pin_order IS '1..n among the profile''s pinned sports (263); NULL when not pinned. ONE writer: pins-server.ts writeSportPins.';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (263, '263_sport_pins.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 263 APPLIED | 2 | true | 263
SELECT '263 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sport_settings' AND column_name IN ('pinned', 'pin_order')) AS cols_expect_2,
       (SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_sport_settings_pin_order')) AS index_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_263;
