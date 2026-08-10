-- ============================================================================
-- Migration 076 — sport-settings hygiene: ratify, drop legacy defaults, and
--                 run the 061-promised hole_number contract
-- ============================================================================
-- WHAT (four things, all Tier-1 hygiene from the sport-settings cleanup):
--   (a) RATIFY sport_settings. The live table was created from a file in the
--       archive (database/archive/old-migrations/create-sport-settings-table
--       .sql) and no numbered migration ever recorded its DDL — this block is
--       that DDL, verbatim and idempotent, so the numbered series is finally
--       self-contained. On a live DB every statement is a no-op.
--   (b) athlete_equipment.sport_key DROP DEFAULT — the 'golf' default came
--       from the legacy create script; the app has written sport_key
--       explicitly on every insert since Aug 1 (equipment API validates it),
--       so the default's only remaining power is to silently mislabel a
--       direct insert as golf.
--   (c) The 061 CONTRACT: drop group_post_media.hole_number + its index.
--       061 added sport-agnostic segment_number/segment_kind, backfilled
--       from hole_number, and dual-wrote both since; its header promised
--       "Migration 06x-contract drops it later". The app's dual-writes,
--       select strings, and read fallbacks are removed in the same PR that
--       carries this file — DEPLOY THE APP FIRST (see order below).
--   (d) profiles golf columns (golf_handicap / golf_home_course): the
--       archived migrate-to-sport-settings.sql left their DROPs commented
--       out, so they MAY exist on the live DB with stray data. The DO-block
--       below checks; if present it first copies non-null values into
--       sport_settings under the schema keys the app reads
--       (src/lib/sports/settings-schemas.ts: 'handicap', 'home_course'),
--       then drops the columns. If absent (expected), it's a no-op.
--
-- ORDER OF OPERATIONS: deploy the app FIRST, then run this. The old app
-- writes and selects group_post_media.hole_number — running (c) under the
-- old app 42703s shared-round media attach AND scorecard reads. The new app
-- neither writes nor selects it, and is fully correct against a DB that
-- still has the column. Rollback note: rolling the APP back after this has
-- run re-breaks media attach (the old insert names the dropped column) —
-- accepted; roll forward instead.
--
-- PRE-FLIGHT:
--   1. sport_settings live shape (expect: 6 columns id/profile_id/sport_key/
--      settings/created_at/updated_at):
--        SELECT column_name, data_type FROM information_schema.columns
--        WHERE table_name = 'sport_settings' ORDER BY ordinal_position;
--   2. Segment/hole parity (expect 0 — the 061 backfill + dual-writes):
--        SELECT count(*) FROM group_post_media
--        WHERE hole_number IS NOT NULL
--          AND segment_number IS DISTINCT FROM hole_number;
--   3. Legacy profile golf columns (expect 0 rows):
--        SELECT column_name FROM information_schema.columns
--        WHERE table_name = 'profiles'
--          AND column_name IN ('golf_handicap', 'golf_home_course');
--
-- Idempotent. Run in the Supabase SQL editor as a single execution.
-- ============================================================================

-- ── (a) sport_settings DDL, ratified ────────────────────────────────────────
-- Structure verbatim from the archive script, with ONE deliberate upgrade:
-- policies use (select auth.uid()) per the MIGRATIONS.md performance
-- convention (the archive used bare auth.uid(); DROP+CREATE re-applies them
-- in the faster form — behaviorally identical).
CREATE TABLE IF NOT EXISTS sport_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sport_key TEXT NOT NULL,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(profile_id, sport_key)
);

COMMENT ON TABLE sport_settings IS
  'Sport-specific settings for athlete profiles (JSONB per sport, schema-driven by src/lib/sports/settings-schemas.ts). Created live from an archived script; DDL ratified as migration 076.';

CREATE INDEX IF NOT EXISTS idx_sport_settings_profile
  ON sport_settings(profile_id);
CREATE INDEX IF NOT EXISTS idx_sport_settings_sport
  ON sport_settings(sport_key);
CREATE INDEX IF NOT EXISTS idx_sport_settings_composite
  ON sport_settings(profile_id, sport_key);
CREATE INDEX IF NOT EXISTS idx_sport_settings_jsonb
  ON sport_settings USING GIN(settings);

ALTER TABLE sport_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own sport settings" ON sport_settings;
CREATE POLICY "Users can view their own sport settings"
  ON sport_settings FOR SELECT
  USING ((select auth.uid()) = profile_id);

DROP POLICY IF EXISTS "Users can insert their own sport settings" ON sport_settings;
CREATE POLICY "Users can insert their own sport settings"
  ON sport_settings FOR INSERT
  WITH CHECK ((select auth.uid()) = profile_id);

DROP POLICY IF EXISTS "Users can update their own sport settings" ON sport_settings;
CREATE POLICY "Users can update their own sport settings"
  ON sport_settings FOR UPDATE
  USING ((select auth.uid()) = profile_id);

DROP POLICY IF EXISTS "Users can delete their own sport settings" ON sport_settings;
CREATE POLICY "Users can delete their own sport settings"
  ON sport_settings FOR DELETE
  USING ((select auth.uid()) = profile_id);

DROP TRIGGER IF EXISTS handle_updated_at_sport_settings ON sport_settings;
CREATE TRIGGER handle_updated_at_sport_settings
  BEFORE UPDATE ON sport_settings
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ── (b) equipment: retire the silent golf default ───────────────────────────
ALTER TABLE athlete_equipment ALTER COLUMN sport_key DROP DEFAULT;

-- ── (c) the 061 contract: hole_number is done ───────────────────────────────
DROP INDEX IF EXISTS idx_group_media_hole;
ALTER TABLE group_post_media DROP COLUMN IF EXISTS hole_number;

-- ── (d) profiles golf columns, if they exist: rescue data, then drop ────────
DO $$
DECLARE
  has_handicap boolean;
  has_home_course boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'golf_handicap'
  ) INTO has_handicap;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'golf_home_course'
  ) INTO has_home_course;

  IF has_handicap OR has_home_course THEN
    -- Copy non-null values into sport_settings under the schema keys the app
    -- reads ('handicap', 'home_course'); merge preserves existing settings.
    EXECUTE format(
      'INSERT INTO sport_settings (profile_id, sport_key, settings)
       SELECT p.id, ''golf'',
         jsonb_strip_nulls(jsonb_build_object(
           ''handicap'', %s,
           ''home_course'', %s
         ))
       FROM profiles p
       WHERE %s
       ON CONFLICT (profile_id, sport_key)
       DO UPDATE SET settings = sport_settings.settings || EXCLUDED.settings',
      CASE WHEN has_handicap THEN 'p.golf_handicap' ELSE 'NULL' END,
      CASE WHEN has_home_course THEN 'p.golf_home_course' ELSE 'NULL' END,
      CASE
        WHEN has_handicap AND has_home_course
          THEN 'p.golf_handicap IS NOT NULL OR p.golf_home_course IS NOT NULL'
        WHEN has_handicap THEN 'p.golf_handicap IS NOT NULL'
        ELSE 'p.golf_home_course IS NOT NULL'
      END
    );
    IF has_handicap THEN
      ALTER TABLE profiles DROP COLUMN golf_handicap;
    END IF;
    IF has_home_course THEN
      ALTER TABLE profiles DROP COLUMN golf_home_course;
    END IF;
    RAISE NOTICE 'profiles golf columns migrated to sport_settings and dropped';
  ELSE
    RAISE NOTICE 'profiles golf columns absent (expected) — nothing to do';
  END IF;
END $$;

-- ============================================================================
-- VERIFY
-- ============================================================================
-- 1. hole_number gone (expect 0 rows):
--      SELECT column_name FROM information_schema.columns
--      WHERE table_name = 'group_post_media' AND column_name = 'hole_number';
--      SELECT indexname FROM pg_indexes
--      WHERE tablename = 'group_post_media' AND indexname = 'idx_group_media_hole';
--
-- 2. Equipment default gone (expect column_default IS NULL):
--      SELECT column_default FROM information_schema.columns
--      WHERE table_name = 'athlete_equipment' AND column_name = 'sport_key';
--
-- 3. profiles golf columns gone (expect 0 rows):
--      SELECT column_name FROM information_schema.columns
--      WHERE table_name = 'profiles'
--      AND column_name IN ('golf_handicap', 'golf_home_course');
--
-- 4. sport_settings intact — policies + trigger present (expect 4 + 1):
--      SELECT policyname FROM pg_policies WHERE tablename = 'sport_settings';
--      SELECT tgname FROM pg_trigger WHERE tgname = 'handle_updated_at_sport_settings';
--
-- 5. Behavioral: attach a photo to a shared-round segment (succeeds,
--    segment_number set); save Edit Profile → Golf settings (upserts).
-- ============================================================================
