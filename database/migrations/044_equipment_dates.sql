-- ============================================================================
-- Migration 044 — User-editable equipment dates ("in bag since" / "retired")
-- ============================================================================
-- Equipment becomes filterable by "in bag during year X". added_at/retired_at
-- stay untouched as server audit timestamps; these DATE columns are the
-- user-facing truth (DATE avoids timezone off-by-one on user-entered dates).
-- Backfilled from the audit timestamps for existing rows.
--
-- Also relaxes the SELECT policy: viewers of public profiles may now see
-- retired gear (the gear timeline is the point of year filtering — and the
-- API already returned retired rows via the admin client; RLS now matches).
--
-- ⚠️ RUN BEFORE DEPLOYING (equipment POST/PATCH write the new columns
--    → 42703 otherwise). Idempotent. Supabase SQL Editor.
-- ============================================================================

ALTER TABLE athlete_equipment ADD COLUMN IF NOT EXISTS acquired_on DATE DEFAULT CURRENT_DATE;
ALTER TABLE athlete_equipment ADD COLUMN IF NOT EXISTS retired_on DATE;
COMMENT ON COLUMN athlete_equipment.acquired_on IS
  'User-editable "in bag since" date; added_at remains the server audit timestamp.';
COMMENT ON COLUMN athlete_equipment.retired_on IS
  'User-editable retirement date; NULL while status = active.';

-- Backfill from server timestamps (idempotent: only fills NULLs)
UPDATE athlete_equipment SET acquired_on = (added_at AT TIME ZONE 'UTC')::date
  WHERE acquired_on IS NULL AND added_at IS NOT NULL;
UPDATE athlete_equipment SET retired_on = (retired_at AT TIME ZONE 'UTC')::date
  WHERE retired_on IS NULL AND retired_at IS NOT NULL;

-- Sanity: can't retire before acquiring
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'equipment_retired_after_acquired'
  ) THEN
    ALTER TABLE athlete_equipment ADD CONSTRAINT equipment_retired_after_acquired
      CHECK (retired_on IS NULL OR acquired_on IS NULL OR retired_on >= acquired_on);
  END IF;
END $$;

-- SELECT policy: drop the status='active' visitor condition (initplan pattern)
DROP POLICY IF EXISTS equipment_select_policy ON athlete_equipment;
CREATE POLICY equipment_select_policy ON athlete_equipment
  FOR SELECT USING (
    profile_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = athlete_equipment.profile_id
        AND p.visibility = 'public'
    )
  );

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'athlete_equipment'
--    AND column_name IN ('acquired_on', 'retired_on');              → 2 rows
-- SELECT COUNT(*) FROM athlete_equipment WHERE acquired_on IS NULL; → 0
-- SELECT qual FROM pg_policies WHERE tablename = 'athlete_equipment'
--    AND policyname = 'equipment_select_policy';  → no status = 'active'
