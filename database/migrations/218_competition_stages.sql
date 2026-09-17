-- ============================================================================
-- 218: competition stages (Competition formats program, track 2 — the
--      first of the track's three schema migrations; 219 = ad-hoc entries,
--      220 = the contest ↔ event match link)
-- ============================================================================
-- A knockout bracket and a meet are STAGES of contests, never a table of
-- their own (the Events phase 3 rule, kept): slot k of stage n+1 is fed by
-- slots 2k−1 and 2k of stage n — BY SLOT, never by id. A meet uses the
-- pair too (stage = session, slot = the order within it; `round` stays the
-- event's name). Both columns are nullable: a fixture or leaderboard
-- contest carries neither.
--
--   * contests.stage smallint, contests.slot smallint — both null, or both
--     >= 1 (`contests_stage_slot_check`).
--   * contests_stage_slot_uniq — a partial UNIQUE on (competition_id,
--     stage, slot) WHERE stage IS NOT NULL: one contest per slot.
--   * idx_competition_entries_seed — (competition_id, seed) WHERE seed IS
--     NOT NULL: the bracket generator reads the seeded order; `seed` has
--     been on competition_entries since 151 ("bracket room"), unwritten
--     until track 2 PR 3's seeding PUT.
--
-- READERS: nothing selects `stage` / `slot` until track 2 PR 3, gated on
-- `check:schema` OK after this ran (a select naming a missing column 404s
-- the whole read — the 207 lesson; contest-view's 42703 ladder takes
-- `stage, slot` as its OUTERMOST step).
-- ============================================================================

ALTER TABLE contests
  ADD COLUMN IF NOT EXISTS stage smallint,
  ADD COLUMN IF NOT EXISTS slot  smallint;

ALTER TABLE contests DROP CONSTRAINT IF EXISTS contests_stage_slot_check;
ALTER TABLE contests ADD CONSTRAINT contests_stage_slot_check
  CHECK ((stage IS NULL AND slot IS NULL) OR (stage >= 1 AND slot >= 1));

CREATE UNIQUE INDEX IF NOT EXISTS contests_stage_slot_uniq
  ON contests (competition_id, stage, slot) WHERE stage IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_competition_entries_seed
  ON competition_entries (competition_id, seed) WHERE seed IS NOT NULL;

COMMENT ON COLUMN contests.stage IS 'A bracket round (1 = the first) or a meet session (218); null on a fixture / leaderboard contest. Slot k of stage n+1 is fed by slots 2k−1 and 2k of stage n — by slot, never by id.';
COMMENT ON COLUMN contests.slot IS 'The contest''s place within its stage (218): the match number of a bracket round, the order within a meet session. UNIQUE per competition × stage.';
COMMENT ON CONSTRAINT contests_stage_slot_check ON contests IS 'stage and slot are both null or both >= 1 (218).';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 218 APPLIED | 2 | 1 | 1
SELECT '218 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'contests' AND column_name IN ('stage', 'slot') AND data_type = 'smallint') AS columns_expect_2,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'contests_stage_slot_uniq' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE%') AS slot_unique_expect_1,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_competition_entries_seed' AND indexdef LIKE '%WHERE%') AS seed_index_expect_1;
