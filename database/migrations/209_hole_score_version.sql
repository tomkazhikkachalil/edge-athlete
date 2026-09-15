-- ============================================================================
-- 209: golf_hole_scores.version — a per-hole compare-and-set (Events
--      program, phase 2b, B3 — the first of its three migrations)
-- ============================================================================
-- WHY. Conflict detection on a shared card compares the CARD's
-- `golf_participant_scores.updated_at` (scoring-authz.ts detectConflict),
-- and the 039 totals trigger bumps that stamp on EVERY hole write by
-- ANYONE — so two group-mates scoring DIFFERENT holes of the same card
-- false-conflict each other, and an offline outbox replaying five holes
-- conflicts on four of them. The unit of a write is the hole; the guard
-- must be too.
--
-- WHAT. `version integer NOT NULL DEFAULT 1` on golf_hole_scores, bumped
-- by a BEFORE UPDATE trigger ONLY when one of the five scored fields
-- (strokes, putts, fairway_hit, green_in_regulation, penalties) actually
-- changes — an idempotent re-send never bumps, and a client can never
-- set the version itself (the ELSE branch pins it to OLD). An INSERT
-- takes the DEFAULT (the 004 `updated_at` trigger is UPDATE-only for the
-- same reason). Why an integer and not `updated_at` (zero DDL): equality
-- on a timestamptz through JSON → localStorage → Date.parse truncates to
-- milliseconds and false-conflicts; NOW() is not monotonic; an integer
-- compares with `!==`, reads in a 409, and enables a real CAS
-- (`UPDATE … WHERE version = expected` → 0 rows = someone else scored it).
-- The name `client_seq` from the phase 1 parked list is DROPPED: the
-- outbox is a set of desired states per (participant, hole) — nothing
-- to sequence.
--
-- READERS. Nothing selects `version` until the next PR (the 42703 rule:
-- a select naming a missing column fails the whole request). `npm run
-- check:schema` reads `CHAIN-ONLY golf_hole_scores.version` until this
-- file has run — that line IS the gate for the PR that reads it.
--
-- The function is SECURITY INVOKER with an empty search_path (the 039
-- shape), and its EXECUTE is revoked from the API roles (the 199 rule —
-- trigger firing does not check EXECUTE). Re-runnable: every statement
-- is IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.
-- ============================================================================

ALTER TABLE golf_hole_scores
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_hole_scores_version_check' AND conrelid = 'public.golf_hole_scores'::regclass) THEN
    ALTER TABLE golf_hole_scores ADD CONSTRAINT golf_hole_scores_version_check CHECK (version >= 1);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.bump_hole_score_version()
RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.strokes, NEW.putts, NEW.fairway_hit, NEW.green_in_regulation, NEW.penalties)
     IS DISTINCT FROM
     (OLD.strokes, OLD.putts, OLD.fairway_hit, OLD.green_in_regulation, OLD.penalties) THEN
    NEW.version = OLD.version + 1;
  ELSE
    NEW.version = OLD.version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

REVOKE EXECUTE ON FUNCTION public.bump_hole_score_version() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_bump_hole_score_version ON golf_hole_scores;
CREATE TRIGGER trigger_bump_hole_score_version
  BEFORE UPDATE ON golf_hole_scores
  FOR EACH ROW EXECUTE FUNCTION public.bump_hole_score_version();

COMMENT ON COLUMN golf_hole_scores.version IS 'Per-hole compare-and-set (209): starts at 1, +1 by trigger_bump_hole_score_version only when a scored field changes. A client sends expected_version; the server updates WHERE version = expected — 0 rows is a conflict (409). Never set by a client.';
COMMENT ON FUNCTION public.bump_hole_score_version() IS 'BEFORE UPDATE on golf_hole_scores (209): bumps version when strokes/putts/fairway_hit/green_in_regulation/penalties change; pins it to OLD otherwise.';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 209 APPLIED | 1 | 1 | 1 | 1
SELECT '209 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_hole_scores' AND column_name = 'version' AND data_type = 'integer' AND is_nullable = 'NO') AS column_expect_1,
       (SELECT count(*) FROM pg_constraint WHERE conname = 'golf_hole_scores_version_check' AND contype = 'c') AS check_expect_1,
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'bump_hole_score_version' AND NOT p.prosecdef) AS function_expect_1,
       (SELECT count(*) FROM pg_trigger WHERE tgname = 'trigger_bump_hole_score_version' AND tgrelid = 'public.golf_hole_scores'::regclass AND NOT tgisinternal) AS trigger_expect_1;
