-- ============================================================================
-- 316: golf_holes.par_estimated — the profile copy of a round keeps the
--      "estimated par" mark (Nov 19 2026; docs/specs/golf-round-setup.md, the
--      Nov 18 note). Runs on BOTH staging and prod. Order-safe: the code that
--      reads and writes the column ships in the same pull request and is
--      merged only after this file has run on production.
-- ============================================================================
-- A course whose map has every hole's line but no par tags gets pars estimated
-- from each hole's length (#1567). The round keeps the mark per hole in its own
-- golf_scorecard_data.hole_data (`parEstimated: true`), and since Nov 19 the
-- posted card, the live page and the scorer show it. The profile copy of the
-- round (golf_holes, written by the round mirror) had no place for it, so the
-- round detail page, the round card and the golf profile showed a guessed par
-- as the course's own.
--
--   par_estimated  true when this hole's par was estimated from the map's hole
--                  length. NOT NULL DEFAULT false: every row written before
--                  today, and every row whose par is a real one, reads false.
--
-- A column on an existing table: golf_holes' grants and policies already cover
-- it. The backfill marks the holes of rounds already mirrored from a group
-- round whose hole_data carries the flag (first seen Nov 18 2026, so few rows).
-- Reversal: ALTER TABLE public.golf_holes DROP COLUMN par_estimated;

ALTER TABLE public.golf_holes
  ADD COLUMN IF NOT EXISTS par_estimated boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.golf_holes.par_estimated IS
  'True when this hole''s par was estimated from the map''s hole length (migration 316); copied from the group round''s hole_data by the round mirror.';

-- ── Backfill: rounds already mirrored from a group round on estimated pars ───
UPDATE public.golf_holes gh
SET par_estimated = true
FROM public.golf_rounds gr
JOIN public.golf_scorecard_data sd ON sd.group_post_id = gr.group_post_id
CROSS JOIN LATERAL jsonb_array_elements(sd.hole_data) AS h
WHERE gh.round_id = gr.id
  AND gr.group_post_id IS NOT NULL
  AND jsonb_typeof(sd.hole_data) = 'array'
  AND (h ->> 'hole')::int = gh.hole_number
  AND h -> 'parEstimated' = 'true'::jsonb
  AND gh.par_estimated = false;

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (316, '316_golf_holes_par_estimated.sql') ON CONFLICT (number) DO NOTHING;

-- Expected: 316 APPLIED | 1 | false | <a small number, 0 is fine> | 316
SELECT '316 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_holes' AND column_name = 'par_estimated') AS column_expect_1,
       (SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'golf_holes' AND column_name = 'par_estimated') AS nullable_expect_false,
       (SELECT count(*) FROM public.golf_holes WHERE par_estimated) AS holes_marked,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_316;
