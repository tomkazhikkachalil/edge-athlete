-- ============================================================================
-- 293: the unit system on the ACCOUNT (Oct 29 2026; the golf steps refinement
--      program's only DDL; runs on BOTH staging and prod BEFORE PR B deploys —
--      the Conditions step's °F / °C toggle and Settings → Account write it)
-- ============================================================================
-- Tom's spec (the golf round steps, step 4): "Add a Fahrenheit / Celsius
-- toggle. Remember the user's choice on their account so it persists across
-- rounds and devices." His call: ONE app-wide preference — the Metric /
-- Imperial choice Settings → Account already offers (temperatures, distances,
-- weights; °C = metric, °F = imperial) — moves from the device onto the
-- account; the device's localStorage copy (ea.activities.unit) becomes the
-- cache, seeded from this column on every profile load (the theme's
-- "server truth first" rule, 069).
--
-- The model (one nullable column — a row without a choice is exactly what it
-- was: the device decides, metric by default):
--   profiles.unit_system  text  'metric' | 'imperial'; NULL = not chosen.
--     Owner-only: GET /api/profile strips it for every viewer
--     (OWNER_ONLY_FIELDS); the departure strip NULLs it. Read ONLY through
--     sanitizeUnitSystem (unit-prefs.ts) — junk never breaks a render. The
--     ONE writer: unit-prefs-server.ts writeUnitSystem, behind
--     PATCH /api/settings/units.
--
-- REVERSAL: ALTER TABLE public.profiles DROP COLUMN unit_system;
-- Re-runnable until the ledger row lands; a second run stops in the pre-flight.
-- No new table: profiles' Data API grants already cover a new column.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 293) THEN
    RAISE EXCEPTION '293 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 292 THEN RAISE EXCEPTION '293 pre-flight: ledger head is %, expected 292', n; END IF;
END $$;

-- ── 1. profiles: the unit system ────────────────────────────────────────────
-- One ALTER per column (account-departure.test.ts reads one column per ALTER).
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS unit_system text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_unit_system_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_unit_system_check
  CHECK (unit_system IS NULL OR unit_system IN ('metric', 'imperial'));
COMMENT ON COLUMN public.profiles.unit_system IS 'The account''s unit system (293): metric (°C, km, kg) or imperial (°F, mi, lb) for everything measured; NULL = not chosen (the device decides). Owner-only. Read through sanitizeUnitSystem; ONE writer: unit-prefs-server.ts writeUnitSystem behind PATCH /api/settings/units.';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (293, '293_profiles_unit_system.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 293 APPLIED | 1 | 293
SELECT '293 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'unit_system') AS col_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_293;
