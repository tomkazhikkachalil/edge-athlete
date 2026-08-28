-- ============================================================================
-- 133: age-preset prompt rider — birthday crossings, never silent (W4)
-- ============================================================================
-- The household policy's "when they're older" overrides need a one-shot
-- prompt when a child crosses the legal threshold. The transfer sweep's
-- eligible_notified row already marks EXACTLY that crossing (same
-- isUnderThreshold, same daily pass, deduped by the one-active-transfer
-- rule) — so the prompt state RIDES that row instead of duplicating the
-- dedupe machinery:
--
--   * 'pending' — at crossing time, at least one guardian's olderDefaults
--     differed from the child's settings. The console queue derives an
--     Apply / Keep card from this; the decision endpoint stamps it.
--   * 'applied' / 'kept' — a guardian decided. Per-CHILD deliberately: the
--     first guardian to decide resolves it for both (one decision per
--     child); the other guardian sees the outcome in the safety feed and
--     deviation chips.
--   * 'none' — no differing older preset existed at crossing time.
--   * NULL — the row predates Wave 4. NEVER prompt retroactively: the
--     decision is computed once, at crossing time; defining olderDefaults
--     later never resurrects old crossings.
--
-- Settings only ever move when a guardian POSTs the apply decision, which
-- routes through the shared applySafetyPatch (consent gate, audit rows).
-- The constraint is NAMED (the 091 auto-name lesson).
-- ============================================================================

ALTER TABLE profile_transfers ADD COLUMN IF NOT EXISTS age_preset_prompt text;
ALTER TABLE profile_transfers DROP CONSTRAINT IF EXISTS profile_transfers_age_preset_prompt_check;
ALTER TABLE profile_transfers ADD CONSTRAINT profile_transfers_age_preset_prompt_check
  CHECK (age_preset_prompt IS NULL OR age_preset_prompt IN ('pending', 'applied', 'kept', 'none'));

COMMENT ON COLUMN profile_transfers.age_preset_prompt IS
  'Wave 4 rider on the eligible_notified row: pending = a guardian older-preset differed at crossing time; applied/kept = guardian decision; none = no differing preset at crossing. NULL = row predates Wave 4 — never prompt retroactively.';

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid — every column must read true ─────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_name = 'profile_transfers'
              AND column_name = 'age_preset_prompt')                  AS column_ok,
  EXISTS (SELECT 1 FROM pg_constraint
            WHERE conname = 'profile_transfers_age_preset_prompt_check'
              AND conrelid = 'profile_transfers'::regclass)           AS constraint_ok;
