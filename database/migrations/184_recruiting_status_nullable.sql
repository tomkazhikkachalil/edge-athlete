-- ============================================================================
-- 184: recruiting_status drops NOT NULL — the row-type insert lesson, again
-- ============================================================================
-- 182 added profiles.recruiting_status NOT NULL DEFAULT 'closed'. A default
-- is not enough: create_managed_profile (053) inserts a WHOLE profile row via
-- jsonb_populate_record(NULL::profiles, …), so every column the JSON does not
-- name arrives as an explicit NULL — the NOT NULL fired and adding a
-- supervised athlete failed the moment 182 ran (the e2e child seed found it;
-- the family console's add-athlete is the same RPC). Same class as 175/179.
--
-- The column becomes nullable; the DEFAULT stays for every writer that
-- omits it. NULL reads as 'closed' everywhere (parseRecruitingStatus), the
-- 182 partial index (recruiting_status <> 'closed') already excludes NULL,
-- and R4's search filters on open/committed only. Nothing else changes.
--
-- RUN IMMEDIATELY on any database where 182 has run. Re-runnable.
-- ============================================================================

ALTER TABLE profiles ALTER COLUMN recruiting_status DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN recruiting_status SET DEFAULT 'closed';

-- Any row born NULL between 182 and now reads as closed already; normalise
-- it anyway so the column carries one vocabulary.
UPDATE profiles SET recruiting_status = 'closed' WHERE recruiting_status IS NULL;

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  (SELECT is_nullable = 'YES' FROM information_schema.columns
     WHERE table_name = 'profiles' AND column_name = 'recruiting_status')                 AS nullable_ok,
  (SELECT column_default LIKE '%closed%' FROM information_schema.columns
     WHERE table_name = 'profiles' AND column_name = 'recruiting_status')                 AS default_ok,
  NOT EXISTS (SELECT 1 FROM profiles WHERE recruiting_status IS NULL)                     AS no_nulls;
