-- ============================================================================
-- 182: recruiting opt-in + the scout account type (Recruiting skeleton R1)
-- ============================================================================
-- The recruiting dataset is the long game; this is its first skeleton. Tom's
-- calls (Sep 10 2026): ONE gate — recruiting_status — decides whether
-- anything recruiting-facing renders or is even selected; academics stay
-- minimal (school + grad year + GPA); a guardian may open recruiting for a
-- supervised athlete (the manage_settings matrix — owner + guardian, never
-- the supervised profile itself); scouts are a new ACCOUNT TYPE, self-
-- service adults like organizers (the code branch lands in R2).
--
--   profiles.recruiting_status   closed | open | committed  (default closed)
--   profiles.recruiting_profile  jsonb — { gpa?, academic_notes?, target_level? },
--                                parsed by src/lib/recruiting/schema.ts
--                                (unknown keys dropped; never selected for a
--                                closed profile)
--   profiles.scout_affiliation   the scout's school / program (≤120)
--   profiles.user_type           + 'scout' (the 097 → 178 pattern)
--
-- school (an existing column no editor wrote) becomes editable in this
-- round; class_year IS the grad year — nothing renamed. No recruiting
-- email: contact goes through the message flow and its first-contact hold.
--
-- ORDER-STRICT: run AFTER 181, BEFORE merging the R1 PR. App code merged
-- ahead degrades: the recruiting GET answers { supported: false }, the
-- PATCH answers 409 "run migration 182", the card renders nothing.
-- Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS recruiting_status  text NOT NULL DEFAULT 'closed',
  ADD COLUMN IF NOT EXISTS recruiting_profile jsonb,
  ADD COLUMN IF NOT EXISTS scout_affiliation  text;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_recruiting_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_recruiting_status_check
  CHECK (recruiting_status IN ('closed', 'open', 'committed'));

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_scout_affiliation_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_scout_affiliation_check
  CHECK (scout_affiliation IS NULL OR char_length(scout_affiliation) <= 120);

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_user_type_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_user_type_check
  CHECK (user_type IN ('athlete', 'club', 'league', 'fan', 'parent', 'organizer', 'scout'));

COMMENT ON COLUMN profiles.recruiting_status IS
  'The ONE recruiting gate (182): closed = nothing recruiting-facing renders; open | committed render the card and enter scout surfaces. Owner or guardian sets it (manage_settings).';
COMMENT ON COLUMN profiles.recruiting_profile IS
  'Self-declared academics (182): { gpa, academic_notes, target_level } — parsed by src/lib/recruiting/schema.ts; never selected when recruiting_status = closed.';
COMMENT ON COLUMN profiles.scout_affiliation IS
  'A scout account''s school or program (182, R2 writes it at signup).';

-- Open profiles are what scout surfaces enumerate (R4 indexes them).
CREATE INDEX IF NOT EXISTS idx_profiles_recruiting_open
  ON profiles (recruiting_status) WHERE recruiting_status <> 'closed';

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'profiles' AND column_name = 'recruiting_status')   AS status_col,
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'profiles' AND column_name = 'recruiting_profile')  AS profile_col,
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'profiles' AND column_name = 'scout_affiliation')   AS affiliation_col,
  (SELECT pg_get_constraintdef(oid) LIKE '%committed%'
     FROM pg_constraint WHERE conname = 'profiles_recruiting_status_check')         AS status_check,
  (SELECT pg_get_constraintdef(oid) LIKE '%scout%'
     FROM pg_constraint WHERE conname = 'profiles_user_type_check')                 AS scout_allowed,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_profiles_recruiting_open') AS open_index;
