-- ============================================================================
-- 143: affiliation_type — recognition gets a vocabulary (phase 0, 0.7)
-- ============================================================================
-- The masterplan's affiliation is self-referential and TYPED (member_of |
-- sanctioned_by | district_of | partner_of). Today's league_clubs is
-- league↔club shaped, so the type lands as a column with the three values
-- that shape can express; district_of arrives with org unification, when
-- the edge becomes (org_id, parent_org_id) and this column reshapes with it.
--
-- DIRECTION CONVENTION (documentation, not schema): the type reads FROM THE
-- CLUB'S side — "the club is a member_of the league", "the club is
-- sanctioned_by the league"; partner_of is symmetric. Picker copy follows.
--
-- INVARIANTS UNCHANGED: affiliation grants nothing (the authorization
-- matrix in src/lib/affiliations/server.ts is untouched — type is
-- descriptive); ONE edge per pair (the PK keeps doubling as
-- duplicate-authority and decline-eraser, per 118's header).
--
-- Backfill = the column default: every existing row becomes partner_of.
--
-- Order-free vs 141/142. Run BEFORE merging the affiliation-types PR (its
-- GET select and insert name the column and would 42703/PGRST204 pre-143).
-- Re-runnable end to end (the check grid is a SELECT).
-- ============================================================================

ALTER TABLE league_clubs
  ADD COLUMN IF NOT EXISTS affiliation_type text NOT NULL DEFAULT 'partner_of';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'league_clubs_affiliation_type_check') THEN
    ALTER TABLE league_clubs ADD CONSTRAINT league_clubs_affiliation_type_check
      CHECK (affiliation_type IN ('partner_of', 'member_of', 'sanctioned_by'));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── Check grid (re-runnable; booleans must all read true, counts are info) ───
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
   WHERE table_name = 'league_clubs' AND column_name = 'affiliation_type') AS type_col_exists,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conname = 'league_clubs_affiliation_type_check') LIKE '%sanctioned_by%' AS type_check_present,
  (SELECT count(*) FROM league_clubs) = (SELECT count(*) FROM league_clubs WHERE affiliation_type = 'partner_of')
    AS backfill_all_partner_pre_deploy,
  (SELECT count(*) FROM league_clubs) AS league_clubs_info;
-- Expect: true × 3 on first run (the third goes false once typed invites
-- exist — it verifies the BACKFILL, run pre-deploy), then one info count.
