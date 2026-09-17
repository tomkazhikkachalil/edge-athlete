-- ============================================================================
-- 219: ad-hoc entries (Competition formats program, track 2 — the second
--      of the track's three schema migrations; 218 = stages, 220 = the
--      contest ↔ event match link)
-- ============================================================================
-- Tom (Sep 16 2026): a game's two sides are AD-HOC now — people playing for
-- fun; an org's default teams pre-fill them later. So the shape an org team
-- can shadow without a rewrite: an entry that is neither a team nor an
-- athlete but a NAME with members.
--
--   * competition_entries.name — the ad-hoc entry's label (1..80); NULL on a
--     team / athlete entry. Promoting it to a club's default team later is
--     `UPDATE … SET team_id` — the name stays the snapshot label.
--   * competition_entries.source_ref — the bridge's idempotency key
--     (`sport_event_side:<id>`), unique per competition when set.
--   * competition_entries.affiliation_team_id — a MEET athlete's team for
--     the roll-up (track 2 PR 7), snapshotted at entry; SET NULL when the
--     team goes; NULL = unattached. NOT `team_id` beside `profile_id`: that
--     would break 151's one-kind rule and every `isTeam = !!team_id` reader.
--   * competition_entries_entrant_check → exactly one of team_id /
--     profile_id, OR both null with a name (DROP + ADD of the one named
--     CHECK — a 23514 window for ad-hoc inserts only; the app inserts them
--     in track 2 PR 6, after check:schema).
--   * competition_entries_uniq (UNIQUE NULLS NOT DISTINCT on the three) —
--     two ad-hoc entries would collide on (comp, null, null). Replaced by
--     four PARTIAL unique indexes: (competition, team) · (competition,
--     profile) · (competition, lower(name)) on ad-hoc rows · (competition,
--     source_ref) when set.
--   * competition_entry_members (posture A): who plays on an entry —
--     `entry_id` CASCADE, `profile_id` CASCADE, `position`, UNIQUE (entry,
--     profile). A team entry MAY carry members too (the masterplan's
--     team-of-individuals).
--
-- READERS: nothing selects the new columns / table until track 2 PR 6,
-- gated on `check:schema` OK after this ran.
-- ============================================================================

ALTER TABLE competition_entries
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS source_ref text,
  ADD COLUMN IF NOT EXISTS affiliation_team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE competition_entries DROP CONSTRAINT IF EXISTS competition_entries_name_check;
ALTER TABLE competition_entries ADD CONSTRAINT competition_entries_name_check
  CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 80);

ALTER TABLE competition_entries DROP CONSTRAINT IF EXISTS competition_entries_entrant_check;
ALTER TABLE competition_entries ADD CONSTRAINT competition_entries_entrant_check
  CHECK (num_nonnulls(team_id, profile_id) = 1 OR (team_id IS NULL AND profile_id IS NULL AND name IS NOT NULL));

ALTER TABLE competition_entries DROP CONSTRAINT IF EXISTS competition_entries_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS competition_entries_team_uniq
  ON competition_entries (competition_id, team_id) WHERE team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS competition_entries_profile_uniq
  ON competition_entries (competition_id, profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS competition_entries_name_uniq
  ON competition_entries (competition_id, lower(name)) WHERE team_id IS NULL AND profile_id IS NULL AND name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS competition_entries_source_ref_uniq
  ON competition_entries (competition_id, source_ref) WHERE source_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS competition_entry_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid NOT NULL REFERENCES competition_entries(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  position   smallint NOT NULL DEFAULT 1 CONSTRAINT competition_entry_members_position_check CHECK (position >= 1),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT competition_entry_members_uniq UNIQUE (entry_id, profile_id)
);

ALTER TABLE competition_entry_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON competition_entry_members FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_competition_entry_members_profile
  ON competition_entry_members (profile_id);

COMMENT ON COLUMN competition_entries.name IS 'An AD-HOC entry''s label (219): neither a team nor an athlete — a named side with members. Promoting it to a club''s team later = SET team_id; the name stays the snapshot label.';
COMMENT ON COLUMN competition_entries.source_ref IS 'The bridge''s idempotency key (219): sport_event_side:<id> — an event''s side minted once as an entry.';
COMMENT ON COLUMN competition_entries.affiliation_team_id IS 'A meet athlete''s team for the roll-up (219): snapshotted at entry, organizer-editable; NULL = unattached. Never a second entrant kind.';
COMMENT ON CONSTRAINT competition_entries_entrant_check ON competition_entries IS 'Exactly one of team_id / profile_id, or an ad-hoc entry: both null with a name (219).';
COMMENT ON TABLE  competition_entry_members IS 'Who plays on an entry (219): an ad-hoc side''s members; a team entry may carry members too. Posture A.';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 219 APPLIED | 3 | 1 | 4 | 1
SELECT '219 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'competition_entries' AND column_name IN ('name', 'source_ref', 'affiliation_team_id')) AS columns_expect_3,
       (SELECT (pg_get_constraintdef(oid) LIKE '%name IS NOT NULL%')::int FROM pg_constraint WHERE conname = 'competition_entries_entrant_check' AND conrelid = 'public.competition_entries'::regclass) AS entrant_check_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'competition_entries' AND indexname IN ('competition_entries_team_uniq', 'competition_entries_profile_uniq', 'competition_entries_name_uniq', 'competition_entries_source_ref_uniq')) AS partial_uniques_expect_4,
       (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename = 'competition_entry_members') AS members_table_expect_1;
