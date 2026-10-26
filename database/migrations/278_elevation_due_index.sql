-- 278 — the elevation-due index matches the RPC's order (post-audit
-- refinements, item 3, Oct 26 2026; docs/SCALE_AUDIT.md §0b).
--
-- Why: golf_map_sweep_elevation_due (255) reads
--   WHERE hole_geometry IS NOT NULL AND external_source <> 'qa-e2e' AND (…due…)
--   ORDER BY hole_elevation_at NULLS FIRST, id LIMIT n
-- over idx_golf_courses_elevation_due (hole_elevation_at) WHERE hole_geometry
-- IS NOT NULL — built default ASC NULLS LAST, so the planner cannot walk it in
-- the query's order: every call (pg_cron, every 2 minutes) read the whole
-- partial index — 146,400,797 tuples over 9,234 calls on production, ~15,900
-- a call, to return at most 50 ids. Rebuilt with the ORDER BY's direction and
-- the two constant predicates, the LIMIT stops after the due rows (NULLs and
-- the oldest stamps sit first). The RPC body is unchanged.
--
-- Also: the progress read's per-tick `count(*) WHERE hole_elevation IS NOT
-- NULL` (22.9 ms × 4,619 calls) gets a partial index of its own.
--
-- Plain CREATE INDEX inline (255's own reasoning: golf_courses is ~29k rows,
-- sub-second; the two-file CONCURRENTLY shape has never shipped). Deploy
-- order: FLEXIBLE. Reversal: 255's index definition.

DROP INDEX IF EXISTS public.idx_golf_courses_elevation_due;
CREATE INDEX IF NOT EXISTS idx_golf_courses_elevation_due
  ON public.golf_courses (hole_elevation_at ASC NULLS FIRST, id)
  WHERE hole_geometry IS NOT NULL AND external_source <> 'qa-e2e';

CREATE INDEX IF NOT EXISTS idx_golf_courses_elevation_done
  ON public.golf_courses (id)
  WHERE hole_elevation IS NOT NULL;

-- The ledger (226): this file records itself.
INSERT INTO public.schema_migrations (number, name) VALUES (278, '278_elevation_due_index.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row) ────────────────────────────────────────────────────────
-- Expected on both: 278 APPLIED | true | true | 278
SELECT '278 APPLIED' AS result,
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_golf_courses_elevation_due' AND indexdef LIKE '%NULLS FIRST%' AND indexdef LIKE '%qa-e2e%') AS due_index_expect_true,
       EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_golf_courses_elevation_done') AS done_index_expect_true,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_278;
