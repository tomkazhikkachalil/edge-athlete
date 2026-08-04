-- ============================================================================
-- Migration 064 — athlete_equipment.group_label (custom equipment sets)
-- ============================================================================
-- WHAT: one nullable TEXT column. An athlete can label items into a named
-- set ("Tournament bag", "Sponsor: Titleist"); labeled items render as their
-- own shelf above the category shelves on the Equipment tab. NULL = the
-- default automatic sport→category grouping, i.e. exactly today's behavior —
-- the feature costs nothing to ignore.
--
-- WHY a column and not a groups table: no ordering, no empty sets, no
-- per-set metadata needed in v1 — a label avoids a join, new RLS policies
-- and a second CRUD surface. Length is capped app-side at 60 chars
-- (EQUIPMENT_FIELD_CAPS.groupLabel in src/lib/equipment-validation.ts);
-- TEXT columns carry no DB cap by house convention.
--
-- ⚠️ ORDER OF OPERATIONS: RUN THIS BEFORE DEPLOYING the PR that ships it.
-- POST /api/equipment and validateEquipmentPatch write `group_label`
-- explicitly, so deployed code without this column 42703s on insert/edit.
-- The GET path is `select('*')` — the column existing BEFORE the code
-- deploys breaks nothing.
--
-- PRE-FLIGHT (expect: column absent):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'athlete_equipment' AND column_name = 'group_label';
--
-- Idempotent. Run in the Supabase SQL editor.
-- ============================================================================

ALTER TABLE athlete_equipment
  ADD COLUMN IF NOT EXISTS group_label TEXT;

COMMENT ON COLUMN athlete_equipment.group_label IS
  'Optional custom set name ("Tournament bag"). NULL = automatic category grouping only. App-capped at 60 chars.';

-- VERIFY (expect: one row, data_type text):
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'athlete_equipment' AND column_name = 'group_label';
