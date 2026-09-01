-- ============================================================================
-- 162: programs + registrations + registration_windows (phase 5, R2)
-- ============================================================================
-- The registration capture layer (masterplan §3.2/§9, locked decision:
-- data only, no money movement). Shape decisions:
--   * The org-scope MEMBERSHIP row (161's lifecycle) is the AUTHORITY for
--     registration state; `registrations` is the SUBMISSION record —
--     which offering was chosen, who submitted, the answers, the
--     eligibility snapshot, audit stamps — and deliberately carries NO
--     status column (one authority, no drift). Phase-6 fees will
--     reference registrations.id: this table is the invoice anchor.
--   * `programs` is a sibling of divisions (masterplan: "offerings that
--     have registrants but no contests — they cannot be an afterthought"),
--     hanging off season_id like divisions; the org derives through the
--     season. `type` is vocab-not-CHECK (the age_band precedent).
--   * `registration_windows` is a table, not columns: v1 opens ONE
--     season-wide window (division/program NULL); per-offering windows
--     arrive later without DDL. A missing window — or this whole table
--     on an older database — reads as CLOSED (fail-safe).
--   * answers jsonb: emergency contact + free-text MEDICAL NOTES (Tom's
--     v1 call). Medical notes are sensitive: served ONLY behind the
--     manage_registration gate — never member previews, never public.
--   * Posture A all three (RLS on, zero policies, REVOKEd).
--
-- ORDER-STRICT: run AFTER 161. App code merged ahead DEGRADES: offerings
-- read empty, windows read closed, registration answers a friendly
-- error. Re-runnable end to end.
--
-- Down-steps (documentation only, never executed): DROP
-- registration_windows; DROP registrations; DROP programs.

CREATE TABLE IF NOT EXISTS programs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id         uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  sport_key         text NOT NULL,
  type              text NOT NULL DEFAULT 'other',
  name              text NOT NULL
    CONSTRAINT programs_name_check CHECK (char_length(name) BETWEEN 1 AND 80),
  capacity_estimate integer
    CONSTRAINT programs_capacity_check CHECK (capacity_estimate IS NULL OR capacity_estimate > 0),
  created_at        timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT programs_season_name_uniq UNIQUE (season_id, name)
);

CREATE TABLE IF NOT EXISTS registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id         uuid REFERENCES clubs(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_id       uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  division_id     uuid REFERENCES divisions(id) ON DELETE SET NULL,
  program_id      uuid REFERENCES programs(id) ON DELETE SET NULL,
  submitted_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  answers         jsonb NOT NULL DEFAULT '{}',
  eligibility     jsonb,
  created_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at      timestamptz NOT NULL DEFAULT timezone('utc', now()),
  withdrawn_at    timestamptz,
  released_at     timestamptz,
  released_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  released_reason text
    CONSTRAINT registrations_reason_check CHECK (char_length(released_reason) <= 300),
  CONSTRAINT registrations_org_check CHECK (num_nonnulls(league_id, club_id) = 1),
  -- The offering starts as exactly one of division/program; ON DELETE SET
  -- NULL can later empty it (the submission record outlives a deleted
  -- offering — §8 invariant 2), so "at most one", not XOR.
  CONSTRAINT registrations_offering_check CHECK (num_nonnulls(division_id, program_id) <= 1),
  CONSTRAINT registrations_uniq UNIQUE NULLS NOT DISTINCT
    (league_id, club_id, profile_id, season_id, division_id, program_id)
);

DROP TRIGGER IF EXISTS registrations_updated_at ON registrations;
CREATE TRIGGER registrations_updated_at
  BEFORE UPDATE ON registrations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TABLE IF NOT EXISTS registration_windows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id   uuid REFERENCES leagues(id) ON DELETE CASCADE,
  club_id     uuid REFERENCES clubs(id) ON DELETE CASCADE,
  season_id   uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  division_id uuid REFERENCES divisions(id) ON DELETE CASCADE,
  program_id  uuid REFERENCES programs(id) ON DELETE CASCADE,
  opens_at    timestamptz NOT NULL,
  closes_at   timestamptz,
  capacity    integer
    CONSTRAINT reg_windows_capacity_check CHECK (capacity IS NULL OR capacity > 0),
  created_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT reg_windows_org_check CHECK (num_nonnulls(league_id, club_id) = 1),
  CONSTRAINT reg_windows_offering_check CHECK (num_nonnulls(division_id, program_id) <= 1),
  CONSTRAINT reg_windows_uniq UNIQUE NULLS NOT DISTINCT
    (league_id, club_id, season_id, division_id, program_id)
);

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE registration_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON programs, registrations, registration_windows FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_programs_season ON programs (season_id);
CREATE INDEX IF NOT EXISTS idx_registrations_season ON registrations (season_id);
CREATE INDEX IF NOT EXISTS idx_registrations_profile ON registrations (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_windows_season ON registration_windows (season_id);

NOTIFY pgrst, 'reload schema';

-- ── Check grid (SELECT-only; safe to re-run) ────────────────────────────────
SELECT
  (SELECT count(*) = 3 FROM information_schema.tables
     WHERE table_name IN ('programs', 'registrations', 'registration_windows'))
                                                                   AS all_three_exist,
  (SELECT bool_and(relrowsecurity) FROM pg_class
     WHERE relname IN ('programs', 'registrations', 'registration_windows'))
                                                                   AS rls_on_all,
  (SELECT count(*) = 1 FROM pg_constraint
     WHERE conname = 'registrations_uniq')                         AS registrations_uniq,
  (SELECT count(*) = 1 FROM pg_constraint
     WHERE conname = 'reg_windows_uniq')                           AS windows_uniq,
  (SELECT pg_get_constraintdef(oid) LIKE '%num_nonnulls%' FROM pg_constraint
     WHERE conname = 'registrations_org_check')                    AS org_xor_present,
  (SELECT count(*) FROM registrations)                             AS registrations_total;
