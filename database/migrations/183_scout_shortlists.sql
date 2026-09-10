-- ============================================================================
-- 183: scout shortlists (Recruiting skeleton R3)
-- ============================================================================
-- A scout's shortlist: one implicit list per scout account, one row per
-- athlete, a private note. The athlete side sees a COUNT only, never the
-- scouts' names (Tom's call, v1). Named lists later = add a list_id.
--
--   scout_shortlists  scout_id → profiles (a 'scout' account, app-enforced
--                     by requireScout), athlete_id → profiles, note ≤500,
--                     PK (scout_id, athlete_id); both CASCADE — deleting
--                     either account deletes the row.
--
-- Posture A like 180: RLS on, ZERO policies, REVOKEd from every client
-- role — every read and write is service-role + requireScout /
-- isRecruitable in app code (the shortlist POST re-checks the athlete is
-- claimed, public and open).
--
-- ORDER-STRICT: run AFTER 182, BEFORE merging the R3 PR. App code merged
-- ahead degrades: the shortlist GET answers { supported: false }, writes
-- answer 409 naming the migration, the button renders nothing.
-- Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

CREATE TABLE IF NOT EXISTS scout_shortlists (
  scout_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  athlete_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  PRIMARY KEY (scout_id, athlete_id),
  CONSTRAINT scout_shortlists_note_check CHECK (note IS NULL OR char_length(note) <= 500),
  CONSTRAINT scout_shortlists_not_self CHECK (scout_id <> athlete_id)
);

-- The athlete side's count ("shortlisted by 3 scouts").
CREATE INDEX IF NOT EXISTS idx_scout_shortlists_athlete ON scout_shortlists (athlete_id);

ALTER TABLE scout_shortlists ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON scout_shortlists FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE scout_shortlists IS
  'A scout account''s shortlist (183): one row per athlete, a private note. Service-role + requireScout only; athletes see a count, never names.';

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'scout_shortlists')      AS table_ok,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'scout_shortlists')                    AS rls_on,
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'scout_shortlists')                  AS zero_policies,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_scout_shortlists_athlete')           AS athlete_index,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scout_shortlists_note_check')           AS note_check,
  NOT has_table_privilege('anon', 'scout_shortlists', 'SELECT')                                AS anon_revoked,
  NOT has_table_privilege('authenticated', 'scout_shortlists', 'SELECT')                       AS authenticated_revoked;
